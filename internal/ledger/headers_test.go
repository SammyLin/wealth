package ledger

import (
	"os"
	"strings"
	"testing"
)

// The Cloudflare deploy serves the page from Static Assets with web/public/_headers; the self-hosted binary
// sets the same policy in Go. Keep the two from drifting.
func TestStaticHeadersMatchCSP(t *testing.T) {
	raw, err := os.ReadFile("../../web/public/_headers")
	if err != nil {
		t.Skip("web/public/_headers not present")
	}
	want := csp()
	for _, line := range strings.Split(string(raw), "\n") {
		if v, ok := strings.CutPrefix(strings.TrimSpace(line), "Content-Security-Policy:"); ok {
			if strings.TrimSpace(v) != want {
				t.Fatalf("_headers CSP differs from csp():\n_headers: %s\nGo:       %s", strings.TrimSpace(v), want)
			}
			return
		}
	}
	t.Fatal("_headers has no Content-Security-Policy line")
}
