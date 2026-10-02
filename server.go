//go:build !js

// Self-hosted entry point: SQLite file on disk, daily backups, optional basic auth.
package main

import (
	"database/sql"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/gin-contrib/gzip"
	"github.com/gin-gonic/gin"
	_ "modernc.org/sqlite"
)

func main() {
	db, err := sql.Open("sqlite", envOr("WEALTH_DB", "wealth.db")+"?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)")
	if err != nil {
		log.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		log.Fatal(err)
	}

	fileBackups = true
	gin.SetMode(envOr("GIN_MODE", gin.ReleaseMode))
	mw := []gin.HandlerFunc{gin.Logger(), gzip.Gzip(gzip.DefaultCompression, gzip.WithExcludedPaths([]string{"/api/backup.db"}))}
	if pass := os.Getenv("WEALTH_PASS"); pass != "" {
		mw = append(mw, gin.BasicAuth(gin.Accounts{envOr("WEALTH_USER", "me"): pass}))
	}
	r := newRouter(db, mw...)
	// the full-database download needs a real file, so it only exists here (D1 has its own Time Travel backups)
	r.GET("/api/backup.db", func(c *gin.Context) {
		f, err := os.CreateTemp("", "wealth-*.db")
		if fail(c, err) {
			return
		}
		f.Close()
		os.Remove(f.Name()) // VACUUM INTO needs a path that doesn't exist yet
		defer os.Remove(f.Name())
		if _, err := db.Exec(`VACUUM INTO ?`, f.Name()); fail(c, err) {
			return
		}
		c.FileAttachment(f.Name(), "wealth-"+time.Now().Format("2006-01-02")+".db")
	})

	go autoBackup(db, envOr("WEALTH_BACKUP_DIR", "backups"), 30)

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

// autoBackup writes a consistent copy (VACUUM INTO, safe with WAL) once a day and keeps the newest `keep`.
func autoBackup(db *sql.DB, dir string, keep int) {
	for {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			log.Println("backup:", err)
		} else {
			path := filepath.Join(dir, "wealth-"+time.Now().Format("2006-01-02")+".db")
			if _, err := os.Stat(path); os.IsNotExist(err) {
				if _, err := db.Exec(`VACUUM INTO ?`, path); err != nil {
					log.Println("backup:", err)
				}
			}
			old, _ := filepath.Glob(filepath.Join(dir, "wealth-*.db"))
			sort.Strings(old) // date-named, so lexical order is chronological
			for len(old) > keep {
				os.Remove(old[0])
				old = old[1:]
			}
		}
		time.Sleep(6 * time.Hour) // checks 4×/day, writes at most one file per date
	}
}
