//go:build !js

package ledger

import (
	"database/sql"
	"fmt"
	"io/fs"

	"github.com/SammyLin/wealth"
)

// Migrate applies migrations/*.sql that the SQLite file hasn't seen yet, tracked in PRAGMA user_version.
// D1 doesn't come through here: wrangler applies the same files and keeps its own record.
func Migrate(db *sql.DB) error {
	files, err := fs.Glob(wealth.Migrations, "migrations/*.sql") // sorted, so 0001 < 0002
	if err != nil {
		return err
	}
	var done int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&done); err != nil {
		return fmt.Errorf("read user_version: %w", err)
	}
	for i := done; i < len(files); i++ {
		q, err := fs.ReadFile(wealth.Migrations, files[i])
		if err != nil {
			return err
		}
		if _, err := db.Exec(string(q)); err != nil {
			return fmt.Errorf("migrate %s: %w", files[i], err)
		}
		if _, err := db.Exec(fmt.Sprintf(`PRAGMA user_version = %d`, i+1)); err != nil {
			return fmt.Errorf("migrate %s: %w", files[i], err)
		}
	}
	return nil
}
