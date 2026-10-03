package ledger

import (
	"context"
	"database/sql"
	"fmt"
)

// Defaults for user-editable settings (the 設定 dialog writes the settings table).
var defaultSettings = map[string]string{
	"title":         "我的帳本",
	"subtitle":      "只記餘額,看見長期趨勢",
	"base_currency": "TWD",
	"unit":          "wan",
	"layout":        defaultLayout,
}

// defaultLayout is the dashboard section order the UI starts with; the layout editor overwrites it.
const defaultLayout = `{"sections":[{"id":"trend","hidden":false},{"id":"mix","hidden":false},{"id":"sheet","hidden":false},{"id":"loans","hidden":false},{"id":"events","hidden":false}]}`

// maxLayoutBytes keeps one settings row small; D1 rows are cheap but not free.
const maxLayoutBytes = 4096

func listKinds(ctx context.Context, db *sql.DB) ([]Kind, error) {
	rows, err := db.QueryContext(ctx, `SELECT key, name, color, liquidity, sort FROM account_kinds ORDER BY sort, key`)
	if err != nil {
		return nil, fmt.Errorf("query kinds: %w", err)
	}
	defer rows.Close()
	out := []Kind{}
	for rows.Next() {
		var k Kind
		if err := rows.Scan(&k.Key, &k.Name, &k.Color, &k.Liquidity, &k.Sort); err != nil {
			return nil, fmt.Errorf("scan kind: %w", err)
		}
		out = append(out, k)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read kinds: %w", err)
	}
	return out, nil
}

func kindMap(kinds []Kind) map[string]Kind {
	m := make(map[string]Kind, len(kinds))
	for _, k := range kinds {
		m[k.Key] = k
	}
	return m
}

func kindExists(ctx context.Context, db *sql.DB, key string) (bool, error) {
	var n int
	err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM account_kinds WHERE key=?`, key).Scan(&n)
	return n > 0, err
}

func settings(ctx context.Context, db *sql.DB) (map[string]string, error) {
	out := map[string]string{}
	for k, v := range defaultSettings {
		out[k] = v
	}
	rows, err := db.QueryContext(ctx, `SELECT key, value FROM settings`)
	if err != nil {
		return nil, fmt.Errorf("query settings: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, fmt.Errorf("scan settings: %w", err)
		}
		out[k] = v
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read settings: %w", err)
	}
	return out, nil
}

func listLoans(ctx context.Context, db *sql.DB) ([]Loan, error) {
	rows, err := db.QueryContext(ctx, `SELECT id, account_id, name, principal, rate, start, grace_months, total_months FROM loans ORDER BY start, id`)
	if err != nil {
		return nil, fmt.Errorf("query loans: %w", err)
	}
	defer rows.Close()
	loans := []Loan{}
	for rows.Next() {
		var l Loan
		if err := rows.Scan(&l.ID, &l.AccountID, &l.Name, &l.Principal, &l.Rate, &l.Start, &l.GraceMonths, &l.TotalMonths); err != nil {
			return nil, fmt.Errorf("scan loan: %w", err)
		}
		loans = append(loans, l)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read loans: %w", err)
	}
	return loans, nil
}
