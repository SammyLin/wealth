package ledger

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

type statusRT int

func (s statusRT) RoundTrip(*http.Request) (*http.Response, error) {
	return &http.Response{StatusCode: int(s), Body: http.NoBody}, nil
}

func TestFetchFXNon200(t *testing.T) {
	old := FXClient
	defer func() { FXClient = old }()
	FXClient = &http.Client{Transport: statusRT(503)}
	if _, err := fetchFX(context.Background(), "usd", "twd", "2024-05-01"); err == nil {
		t.Fatal("non-200 accepted")
	}
}

// byHost answers per host: the first (jsdelivr) can be down while the fallback (pages.dev) answers.
type byHost map[string]string

func (b byHost) RoundTrip(req *http.Request) (*http.Response, error) {
	if body, ok := b[req.URL.Host]; ok {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}, nil
	}
	return &http.Response{StatusCode: 404, Body: http.NoBody}, nil
}

func TestFetchFX(t *testing.T) {
	old := FXClient
	defer func() { FXClient = old }()
	usd := `{"date":"2024-05-01","usd":{"twd":32.5,"jpy":155}}`

	FXClient = &http.Client{Transport: byHost{"cdn.jsdelivr.net": usd}}
	if rate, err := fetchFX(context.Background(), "USD", "TWD", "2024-05-01"); err != nil || rate != 32.5 {
		t.Errorf("jsdelivr: %v %v", rate, err)
	}
	FXClient = &http.Client{Transport: byHost{"2024-05-01.currency-api.pages.dev": usd}}
	if rate, err := fetchFX(context.Background(), "usd", "jpy", "2024-05-01"); err != nil || rate != 155 {
		t.Errorf("fallback: %v %v", rate, err)
	}
	if _, err := fetchFX(context.Background(), "usd", "eur", "2024-05-01"); err == nil {
		t.Error("a currency missing from the table must fail, not return 0")
	}
	if _, err := fetchFX(context.Background(), "u$d", "twd", "2024-05-01"); err == nil {
		t.Error("bad currency accepted")
	}
}
