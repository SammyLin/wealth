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
