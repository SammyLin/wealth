//go:build !js

// Self-hosted entry point: SQLite file on disk, daily backups, optional basic auth.
package main

import (
	"crypto/subtle"
	"database/sql"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-contrib/gzip"
	"github.com/gin-gonic/gin"
	_ "modernc.org/sqlite"

	"github.com/SammyLin/wealth/internal/ledger"
)

func main() {
	if len(os.Args) > 1 && (os.Args[1] == "--version" || os.Args[1] == "-v") {
		fmt.Println("wealth", ledger.Version)
		return
	}
	db, err := sql.Open("sqlite", envOr("WEALTH_DB", "wealth.db")+"?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
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
		mw = append(mw, basicAuth(envOr("WEALTH_USER", "me"), pass, time.Second))
	} else {
		// WEALTH_NO_PASS=1: compose publishes the port on the host's 127.0.0.1 only, so the container's 0.0.0.0
		// is still local; localHostsOnly below keeps rejecting any other Host name either way.
		if !strings.HasPrefix(addr, "127.0.0.1:") && !strings.HasPrefix(addr, "localhost:") && os.Getenv("WEALTH_NO_PASS") != "1" {
			log.Fatal("refusing to listen on a public address without WEALTH_PASS")
		}
		mw = append(mw, localHostsOnly(os.Getenv("WEALTH_HOSTS")))
	}
	ledger.SystemFonts = os.Getenv("WEALTH_FONTS") == "system"
	r := ledger.New(db, true, mw...)
	r.GET("/api/backup.db", ledger.DownloadBackup(db))

	go ledger.AutoBackup(db, envOr("WEALTH_BACKUP_DIR", "backups"), 30)

	log.Printf("wealth %s on http://%s", ledger.Version, addr)
	srv := &http.Server{Addr: addr, Handler: r, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 2 * time.Minute}
	log.Fatal(srv.ListenAndServe())
}

// basicAuth checks the credentials (except /healthz: container healthchecks have none). A wrong guess waits
// `delay` before its 401, one guess at a time across all clients, so guessing runs at about one try per delay.
// ponytail: one global queue, not per-IP lockouts; a proxy (fail2ban, Caddy rate limits) does that better.
func basicAuth(user, pass string, delay time.Duration) gin.HandlerFunc {
	var wrong sync.Mutex
	return func(c *gin.Context) {
		if c.Request.URL.Path == "/healthz" {
			c.Next()
			return
		}
		u, p, ok := c.Request.BasicAuth()
		if ok && subtle.ConstantTimeCompare([]byte(u), []byte(user))&subtle.ConstantTimeCompare([]byte(p), []byte(pass)) == 1 {
			c.Next()
			return
		}
		if ok { // a guess, not the browser's first request that only asks for the prompt
			wrong.Lock()
			time.Sleep(delay)
			wrong.Unlock()
		}
		c.Header("WWW-Authenticate", `Basic realm="wealth", charset="UTF-8"`)
		c.AbortWithStatus(http.StatusUnauthorized)
	}
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
