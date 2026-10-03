//go:build !js

// Self-hosted entry point: SQLite file on disk, daily backups, optional basic auth.
package main

import (
	"database/sql"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-contrib/gzip"
	"github.com/gin-gonic/gin"
	_ "modernc.org/sqlite"

	"github.com/SammyLin/wealth/internal/ledger"
)

func main() {
	db, err := sql.Open("sqlite", envOr("WEALTH_DB", "wealth.db")+"?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)")
	if err != nil {
		log.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if err := ledger.Migrate(db); err != nil {
		log.Fatal(err)
	}

	gin.SetMode(envOr("GIN_MODE", gin.ReleaseMode))
	mw := []gin.HandlerFunc{gin.Logger(), gzip.Gzip(gzip.DefaultCompression, gzip.WithExcludedPaths([]string{"/api/backup.db"}))}
	addr := envOr("WEALTH_ADDR", "127.0.0.1:8080")
	if pass := os.Getenv("WEALTH_PASS"); pass != "" {
		if pass == "change-me" { // the placeholder in .env.example
			log.Fatal("WEALTH_PASS is still the example value; pick a real password")
		}
		auth := gin.BasicAuth(gin.Accounts{envOr("WEALTH_USER", "me"): pass})
		mw = append(mw, func(c *gin.Context) {
			if c.Request.URL.Path == "/healthz" { // container healthchecks have no credentials
				c.Next()
				return
			}
			auth(c)
		})
	} else {
		if !strings.HasPrefix(addr, "127.0.0.1:") && !strings.HasPrefix(addr, "localhost:") {
			log.Fatal("refusing to listen on a public address without WEALTH_PASS")
		}
		mw = append(mw, localHostsOnly(os.Getenv("WEALTH_HOSTS")))
	}
	r := ledger.New(db, true, mw...)
	r.GET("/api/backup.db", ledger.DownloadBackup(db))

	go ledger.AutoBackup(db, envOr("WEALTH_BACKUP_DIR", "backups"), 30)

	log.Printf("wealth on http://%s", addr)
	srv := &http.Server{Addr: addr, Handler: r, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 2 * time.Minute}
	log.Fatal(srv.ListenAndServe())
}

// localHostsOnly guards the no-password mode against DNS rebinding: a page on evil.example that points its
// name at 127.0.0.1 still sends Host: evil.example, so only loopback names (plus WEALTH_HOSTS, comma-separated) pass.
func localHostsOnly(extra string) gin.HandlerFunc {
	ok := map[string]bool{"localhost": true, "127.0.0.1": true, "::1": true}
	for _, h := range strings.Split(extra, ",") {
		if h = strings.TrimSpace(h); h != "" {
			ok[strings.ToLower(h)] = true
		}
	}
	return func(c *gin.Context) {
		host := c.Request.Host
		if h, _, err := net.SplitHostPort(host); err == nil {
			host = h
		}
		if !ok[strings.ToLower(strings.Trim(host, "[]"))] {
			c.AbortWithStatusJSON(http.StatusMisdirectedRequest, gin.H{"error": "unknown host; add it to WEALTH_HOSTS"})
			return
		}
		c.Next()
	}
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
