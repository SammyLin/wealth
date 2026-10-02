package ledger

import (
	"context"
	"net/http"
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
