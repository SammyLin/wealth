//go:build !js

// Self-hosted entry point: SQLite file on disk, daily backups, optional basic auth.
package main

import (
	"database/sql"
	"log"
	"net/http"
	"os"
	"strings"

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
	if pass := os.Getenv("WEALTH_PASS"); pass != "" {
		mw = append(mw, gin.BasicAuth(gin.Accounts{envOr("WEALTH_USER", "me"): pass}))
	}
	r := ledger.New(db, true, mw...)
	r.GET("/api/backup.db", ledger.DownloadBackup(db))

	go ledger.AutoBackup(db, envOr("WEALTH_BACKUP_DIR", "backups"), 30)

	addr := envOr("WEALTH_ADDR", "127.0.0.1:8080")
	if os.Getenv("WEALTH_PASS") == "" && !strings.HasPrefix(addr, "127.0.0.1:") && !strings.HasPrefix(addr, "localhost:") {
		log.Fatal("refusing to listen on a public address without WEALTH_PASS")
	}
	log.Printf("wealth on http://%s", addr)
	log.Fatal(http.ListenAndServe(addr, r))
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
