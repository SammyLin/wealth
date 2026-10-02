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
