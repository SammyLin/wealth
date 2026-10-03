//go:build !js

package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestBasicAuth(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(basicAuth("me", "secret", 50*time.Millisecond))
	r.GET("/*any", func(c *gin.Context) { c.String(http.StatusOK, "ok") })
	get := func(path, user, pass string) (int, time.Duration) {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		if user != "" {
			req.SetBasicAuth(user, pass)
		}
		w := httptest.NewRecorder()
		start := time.Now()
		r.ServeHTTP(w, req)
		return w.Code, time.Since(start)
	}
	if code, _ := get("/", "me", "secret"); code != http.StatusOK {
		t.Errorf("right password: %d", code)
	}
	if code, d := get("/", "", ""); code != http.StatusUnauthorized || d >= 50*time.Millisecond {
		t.Errorf("no credentials: %d after %v (the prompt shouldn't wait)", code, d)
	}
	if code, d := get("/", "me", "guess"); code != http.StatusUnauthorized || d < 50*time.Millisecond {
		t.Errorf("wrong password: %d after %v, want 401 after the delay", code, d)
	}
	if code, _ := get("/healthz", "", ""); code != http.StatusOK {
		t.Errorf("/healthz needs no credentials: %d", code)
	}
}
