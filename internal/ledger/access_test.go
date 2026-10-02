package ledger

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
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
