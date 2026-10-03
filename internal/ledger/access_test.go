package ledger

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

type fixedKeys map[string]*rsa.PublicKey

func (f fixedKeys) key(kid string) (*rsa.PublicKey, error) {
	if k := f[kid]; k != nil {
		return k, nil
	}
	return nil, errUnknown
}

var errUnknown = errors.New("unknown key")

func sign(t *testing.T, k *rsa.PrivateKey, kid string, claims map[string]any) string {
	enc := func(v any) string { b, _ := json.Marshal(v); return base64.RawURLEncoding.EncodeToString(b) }
	in := enc(map[string]string{"alg": "RS256", "kid": kid}) + "." + enc(claims)
	sum := sha256.Sum256([]byte(in))
	sig, err := rsa.SignPKCS1v15(rand.Reader, k, crypto.SHA256, sum[:])
	if err != nil {
		t.Fatal(err)
	}
	return in + "." + base64.RawURLEncoding.EncodeToString(sig)
}

func TestVerifyAccessJWT(t *testing.T) {
	k, _ := rsa.GenerateKey(rand.Reader, 2048)
	other, _ := rsa.GenerateKey(rand.Reader, 2048)
	keys := fixedKeys{"k1": &k.PublicKey}
	now := time.Now()
	good := map[string]any{"aud": []string{"app-aud"}, "exp": now.Add(time.Hour).Unix()}

	if err := verifyAccessJWT(sign(t, k, "k1", good), "app-aud", keys, now); err != nil {
		t.Fatalf("valid token rejected: %v", err)
	}
	cases := map[string]string{
		"wrong aud":   sign(t, k, "k1", map[string]any{"aud": "other", "exp": now.Add(time.Hour).Unix()}),
		"expired":     sign(t, k, "k1", map[string]any{"aud": "app-aud", "exp": now.Add(-time.Minute).Unix()}),
		"forged":      sign(t, other, "k1", good),
		"unknown kid": sign(t, k, "k2", good),
		"empty":       "",
		"tampered":    strings.Replace(sign(t, k, "k1", good), ".", ".x", 1),
	}
	for name, tok := range cases {
		if verifyAccessJWT(tok, "app-aud", keys, now) == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

// The Worker's whole guard, through a router: Access JWT from the header or the cookie, against a key set
// served over TLS like Cloudflare's certs endpoint, and the ALLOW_PUBLIC / unset fallbacks.
func TestAccessGuard(t *testing.T) {
	gin.SetMode(gin.TestMode)
	k, _ := rsa.GenerateKey(rand.Reader, 2048)
	b64 := base64.RawURLEncoding.EncodeToString
	certs := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/cdn-cgi/access/certs" {
			http.NotFound(w, r)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{"kid": "k1", "n": b64(k.N.Bytes()), "e": b64(big.NewInt(int64(k.E)).Bytes())}}})
	}))
	defer certs.Close()
	team := strings.TrimPrefix(certs.URL, "https://")
	env := func(m map[string]string) func(string) string { return func(k string) string { return m[k] } }
	router := func(getenv func(string) string) *gin.Engine {
		r := gin.New()
		r.Use(AccessFromEnv(getenv, certs.Client()))
		r.GET("/api/state", func(c *gin.Context) { c.String(200, "ok") })
		return r
	}
	guarded := router(env(map[string]string{"ACCESS_TEAM_DOMAIN": team, "ACCESS_AUD": "app-aud"}))
	exp := time.Now().Add(time.Hour).Unix()
	valid := sign(t, k, "k1", map[string]any{"aud": "app-aud", "exp": exp})

	for _, c := range []struct {
		name           string
		r              *gin.Engine
		header, cookie string
		want           int
	}{
		{"no header", guarded, "", "", 403},
		{"bad aud", guarded, sign(t, k, "k1", map[string]any{"aud": "someone-else", "exp": exp}), "", 403},
		{"expired", guarded, sign(t, k, "k1", map[string]any{"aud": "app-aud", "exp": time.Now().Add(-time.Minute).Unix()}), "", 403},
		{"garbage", guarded, "not.a.jwt", "", 403},
		{"valid header", guarded, valid, "", 200},
		{"valid cookie", guarded, "", valid, 200},
		{"ALLOW_PUBLIC", router(env(map[string]string{"ALLOW_PUBLIC": "1"})), "", "", 200},
		{"half configured fails closed", router(env(map[string]string{"ACCESS_TEAM_DOMAIN": team})), "", "", 503},
		{"nothing set fails closed", router(env(nil)), "", "", 503},
	} {
		req := httptest.NewRequest("GET", "/api/state", nil)
		if c.header != "" {
			req.Header.Set("Cf-Access-Jwt-Assertion", c.header)
		}
		if c.cookie != "" {
			req.AddCookie(&http.Cookie{Name: "CF_Authorization", Value: c.cookie})
		}
		w := httptest.NewRecorder()
		c.r.ServeHTTP(w, req)
		if w.Code != c.want {
			t.Errorf("%s: status %d want %d (%s)", c.name, w.Code, c.want, w.Body.String())
		}
	}
}
