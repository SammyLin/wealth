//go:build js && wasm

// Cloudflare Workers entry point: same router, database is the D1 binding "DB".
// Cloudflare compresses responses, so no gzip middleware here.
package main

import (
	"database/sql"
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/syumai/workers-go"
	"github.com/syumai/workers-go/cloudflare"
	_ "github.com/syumai/workers-go/cloudflare/d1"
	"github.com/syumai/workers-go/cloudflare/fetch"
)

func main() {
	db, err := sql.Open("d1", "DB")
	if err != nil {
		panic(err)
	}
	fxClient = fetch.NewClient().HTTPClient(fetch.RedirectModeFollow)
	gin.SetMode(gin.ReleaseMode)
	workers.Serve(newRouter(db, accessFromEnv()))
}

// accessFromEnv fails closed: without ACCESS_TEAM_DOMAIN + ACCESS_AUD the Worker refuses to serve,
// unless ALLOW_PUBLIC=1 says the open URL is intended. Env vars are only readable during a request.
func accessFromEnv() gin.HandlerFunc {
	var once sync.Once
	var guard gin.HandlerFunc
	return func(c *gin.Context) {
		once.Do(func() {
			team, aud := cloudflare.Getenv("ACCESS_TEAM_DOMAIN"), cloudflare.Getenv("ACCESS_AUD")
			switch {
			case team != "" && aud != "":
				guard = accessGuard(team, aud, fxClient)
			case cloudflare.Getenv("ALLOW_PUBLIC") == "1":
				guard = func(c *gin.Context) { c.Next() }
			default:
				guard = func(c *gin.Context) {
					c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "Set ACCESS_TEAM_DOMAIN and ACCESS_AUD (Cloudflare Access), or ALLOW_PUBLIC=1."})
				}
			}
		})
		guard(c)
	}
}
