//go:build js && wasm

// Cloudflare Workers entry point: same router, database is the D1 binding "DB".
// Cloudflare compresses responses, so no gzip middleware here.
package main

import (
	"database/sql"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/syumai/workers-go"
	"github.com/syumai/workers-go/cloudflare"
	_ "github.com/syumai/workers-go/cloudflare/d1"
	"github.com/syumai/workers-go/cloudflare/fetch"

	"github.com/SammyLin/wealth/internal/ledger"
)

func main() {
	db, err := sql.Open("d1", "DB")
	if err != nil {
		panic(err)
	}
	ledger.FXClient = fetch.NewClient().HTTPClient(fetch.RedirectModeFollow)
	gin.SetMode(gin.ReleaseMode)
	workers.Serve(ledger.New(db, false, accessFromEnv()))
}

// accessFromEnv builds ledger.AccessFromEnv's guard on the first request: env vars are only readable during one.
func accessFromEnv() gin.HandlerFunc {
	var once sync.Once
	var guard gin.HandlerFunc
	return func(c *gin.Context) {
		once.Do(func() { guard = ledger.AccessFromEnv(cloudflare.Getenv, ledger.FXClient) })
		guard(c)
	}
}
