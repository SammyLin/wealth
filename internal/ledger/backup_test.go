//go:build !js

package ledger

import (
	"bytes"
	"database/sql"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDownloadBackup(t *testing.T) {
	r, db := newTestRouter(t)
	r.GET("/api/backup.db", DownloadBackup(db))
	wantStatus(t, callJSON(t, r, "POST", "/api/accounts", `{"name":"A","kind":"bank"}`, nil), 201)
	w := callJSON(t, r, "GET", "/api/backup.db", "", nil)
	wantStatus(t, w, 200)
	if !bytes.HasPrefix(w.Body.Bytes(), []byte("SQLite format 3\x00")) {
		t.Fatalf("not a SQLite file: %q", w.Body.Bytes()[:min(16, w.Body.Len())])
	}
	if cd := w.Header().Get("Content-Disposition"); !bytes.Contains([]byte(cd), []byte("wealth-")) {
		t.Errorf("Content-Disposition %q", cd)
	}
	// the copy is a working ledger with the account in it
	path := filepath.Join(t.TempDir(), "copy.db")
	if err := os.WriteFile(path, w.Body.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	cp, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer cp.Close()
	var name string
	if err := cp.QueryRow(`SELECT name FROM accounts`).Scan(&name); err != nil || name != "A" {
		t.Fatalf("backup content: %q %v", name, err)
	}
}

func TestBackupOnceKeepsNewest(t *testing.T) {
	db := newTestDB(t)
	dir := t.TempDir()
	for _, d := range []string{"2020-01-01", "2020-01-02", "2020-01-03"} {
		os.WriteFile(filepath.Join(dir, "wealth-"+d+".db"), []byte("old"), 0o600)
	}
	now := time.Date(2026, 10, 4, 9, 0, 0, 0, time.UTC)
	if err := backupOnce(db, dir, 2, now); err != nil {
		t.Fatal(err)
	}
	got, _ := filepath.Glob(filepath.Join(dir, "wealth-*.db"))
	if len(got) != 2 || filepath.Base(got[0]) != "wealth-2020-01-03.db" || filepath.Base(got[1]) != "wealth-2026-10-04.db" {
		t.Fatalf("kept %v", got)
	}
	// a second run the same day doesn't rewrite today's file
	os.WriteFile(got[1], []byte("marker"), 0o600)
	if err := backupOnce(db, dir, 2, now); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(got[1]); string(b) != "marker" {
		t.Error("today's backup was rewritten")
	}
}
