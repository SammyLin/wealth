//go:build !js

// File backups for the self-hosted server. On Workers, D1 Time Travel covers backups instead.
package ledger

import (
	"database/sql"
	"log"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/gin-gonic/gin"
)

// DownloadBackup streams a consistent copy of the whole database. It needs a real file,
// so it only exists on the self-hosted server.
func DownloadBackup(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		// a private 0700 dir: VACUUM INTO creates its file 0644, and needs a path that doesn't exist yet
		dir, err := os.MkdirTemp("", "wealth-*")
		if fail(c, err) {
			return
		}
		defer os.RemoveAll(dir)
		path := filepath.Join(dir, "wealth.db")
		if _, err := db.Exec(`VACUUM INTO ?`, path); fail(c, err) {
			return
		}
		c.FileAttachment(path, "wealth-"+time.Now().Format("2006-01-02")+".db")
	}
}

// AutoBackup writes a consistent copy (VACUUM INTO, safe with WAL) once a day and keeps the newest `keep`.
func AutoBackup(db *sql.DB, dir string, keep int) {
	for {
		if err := backupOnce(db, dir, keep, time.Now()); err != nil {
			log.Println("backup:", err)
		}
		time.Sleep(6 * time.Hour) // checks 4×/day, writes at most one file per date
	}
}

// backupOnce writes now's dated copy unless it exists, then deletes all but the newest `keep`.
func backupOnce(db *sql.DB, dir string, keep int, now time.Time) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	path := filepath.Join(dir, "wealth-"+now.Format("2006-01-02")+".db")
	if _, err := os.Stat(path); os.IsNotExist(err) {
		if _, err := db.Exec(`VACUUM INTO ?`, path); err != nil {
			return err
		}
		if err := os.Chmod(path, 0o600); err != nil {
			return err
		}
	}
	old, _ := filepath.Glob(filepath.Join(dir, "wealth-*.db"))
	sort.Strings(old) // date-named, so lexical order is chronological
	for len(old) > keep {
		if err := os.Remove(old[0]); err != nil {
			return err
		}
		old = old[1:]
	}
	return nil
}
