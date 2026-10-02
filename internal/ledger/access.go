package ledger

import (
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// AccessGuard rejects any request without a valid Cloudflare Access JWT for this app.
// Access already blocks strangers at the edge; this is the second lock in case a route,
// preview URL or misconfigured policy ever lets a request reach the Worker directly.
// team: "yourteam.cloudflareaccess.com", aud: the Access application's AUD tag.
func AccessGuard(team, aud string, client *http.Client) gin.HandlerFunc {
	keys := &jwks{url: "https://" + team + "/cdn-cgi/access/certs", client: client}
	return func(c *gin.Context) {
		tok := c.GetHeader("Cf-Access-Jwt-Assertion")
		if tok == "" {
			if ck, err := c.Cookie("CF_Authorization"); err == nil {
				tok = ck
			}
		}
		if err := verifyAccessJWT(tok, aud, keys, time.Now()); err != nil {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "需要透過 Cloudflare Access 登入"})
			return
		}
		c.Next()
	}
}

type jwks struct {
	url     string
	client  *http.Client
	mu      sync.Mutex
	keys    map[string]*rsa.PublicKey
	fetched time.Time
}

// key returns the signing key for kid, refetching the key set (at most once a minute) when unknown,
// so Access key rotation is picked up without a redeploy.
func (j *jwks) key(kid string) (*rsa.PublicKey, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if k := j.keys[kid]; k != nil {
		return k, nil
	}
	if time.Since(j.fetched) < time.Minute {
		return nil, errors.New("unknown key")
	}
	j.fetched = time.Now()
	res, err := j.client.Get(j.url)
	if err != nil {
		return nil, fmt.Errorf("fetch access certs: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch access certs: status %d", res.StatusCode)
	}
	var set struct {
		Keys []struct{ Kid, N, E string } `json:"keys"`
	}
	if err := json.NewDecoder(res.Body).Decode(&set); err != nil {
		return nil, fmt.Errorf("decode access certs: %w", err)
	}
	j.keys = map[string]*rsa.PublicKey{}
	for _, k := range set.Keys {
		n, err1 := base64.RawURLEncoding.DecodeString(k.N)
		e, err2 := base64.RawURLEncoding.DecodeString(k.E)
		if err1 == nil && err2 == nil {
			j.keys[k.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(new(big.Int).SetBytes(e).Int64())}
		}
	}
	if k := j.keys[kid]; k != nil {
		return k, nil
	}
	return nil, errors.New("unknown key")
}

func verifyAccessJWT(tok, aud string, keys interface {
	key(string) (*rsa.PublicKey, error)
}, now time.Time) error {
	parts := strings.Split(tok, ".")
	if len(parts) != 3 {
		return errors.New("malformed token")
	}
	var head struct{ Alg, Kid string }
	var claims struct {
		Aud audience `json:"aud"`
		Exp int64    `json:"exp"`
		Nbf int64    `json:"nbf"`
	}
	if err := decodeSegment(parts[0], &head); err != nil || head.Alg != "RS256" {
		return errors.New("bad header")
	}
	if err := decodeSegment(parts[1], &claims); err != nil {
		return errors.New("bad claims")
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return fmt.Errorf("bad signature encoding: %w", err)
	}
	pub, err := keys.key(head.Kid)
	if err != nil {
		return fmt.Errorf("signing key: %w", err)
	}
	sum := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if err := rsa.VerifyPKCS1v15(pub, crypto.SHA256, sum[:], sig); err != nil {
		return errors.New("bad signature")
	}
	if !slices.Contains(claims.Aud, aud) {
		return errors.New("wrong audience")
	}
	if now.Unix() >= claims.Exp || (claims.Nbf != 0 && now.Unix() < claims.Nbf-60) {
		return errors.New("expired")
	}
	return nil
}

func decodeSegment(s string, v any) error {
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

// audience accepts the JWT "aud" claim as either a string or an array of strings.
type audience []string

func (a *audience) UnmarshalJSON(b []byte) error {
	var one string
	if json.Unmarshal(b, &one) == nil {
		*a = []string{one}
		return nil
	}
	return json.Unmarshal(b, (*[]string)(a))
}
