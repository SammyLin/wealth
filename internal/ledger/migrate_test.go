//go:build !js

package ledger

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestMigrateIsIdempotent(t *testing.T) {
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for range 2 {
		if err := Migrate(db); err != nil {
			t.Fatal(err)
		}
	}
	var v int
	db.QueryRow(`PRAGMA user_version`).Scan(&v)
	if v < 1 {
		t.Fatalf("user_version %d", v)
	}
	if _, err := db.Exec(`INSERT INTO accounts (name, kind, currency) VALUES ('a', 'bank', 'TWD')`); err != nil {
		t.Fatalf("schema missing: %v", err)
	}
}
