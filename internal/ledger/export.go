package ledger

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/csv"
	"fmt"
	"sort"
	"strconv"
)

var kindLabel = map[string]string{"bank": "銀行", "tw_stock": "台股", "us_stock": "美股", "movable": "動產",
	"real_estate": "不動產", "crypto": "加密貨幣", "liability": "負債"}

// exportCSV writes a spreadsheet-friendly layout: one row per account,
// one column per snapshot date, balances in the account's own currency, plus totals in the base currency.
// A UTF-8 BOM makes Excel read the Chinese correctly.
func exportCSV(ctx context.Context, db *sql.DB) ([]byte, error) {
	type acct struct {
		id              int64
		name, kind, cur string
		archived        bool
	}
	var accts []acct
	rows, err := db.QueryContext(ctx, `SELECT id, name, kind, currency, archived FROM accounts ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("export accounts: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var a acct
		if err := rows.Scan(&a.id, &a.name, &a.kind, &a.cur, &a.archived); err != nil {
			return nil, fmt.Errorf("export accounts: %w", err)
		}
		accts = append(accts, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("export accounts: %w", err)
	}
	rows.Close()

	vals := map[int64]map[string]float64{}
	kindOf := map[int64]string{}
	for _, a := range accts {
		vals[a.id], kindOf[a.id] = map[string]float64{}, a.kind
	}
	var snaps []Snapshot
	fxByDate := map[string]float64{}
	rows, err = db.QueryContext(ctx, `SELECT account_id, date, amount, fx FROM snapshots`)
	if err != nil {
		return nil, fmt.Errorf("export snapshots: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var s Snapshot
		if err := rows.Scan(&s.AccountID, &s.Date, &s.Amount, &s.FX); err != nil {
			return nil, fmt.Errorf("export snapshots: %w", err)
		}
		if vals[s.AccountID] == nil { // orphaned snapshot, skipped like /api/state does
			continue
		}
		snaps = append(snaps, s)
		vals[s.AccountID][s.Date] = s.Amount
		if s.FX != 1 {
			fxByDate[s.Date] = s.FX
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("export snapshots: %w", err)
	}

	totals := series(snaps, kindOf)
	dates := make([]string, len(totals))
	for i, r := range totals {
		dates[i] = r.Date
	}
	sort.Strings(dates)

	var buf bytes.Buffer
	buf.WriteString("\xef\xbb\xbf")
	w := csv.NewWriter(&buf)
	set, err := settings(ctx, db)
	if err != nil {
		return nil, err
	}
	base := set["base_currency"]
	w.Write(append([]string{"帳戶", "類別", "幣別", "封存"}, dates...))
	for _, a := range accts {
		row := []string{a.name, kindLabel[a.kind], a.cur, map[bool]string{true: "是", false: ""}[a.archived]}
		for _, d := range dates {
			if v, ok := vals[a.id][d]; ok {
				row = append(row, strconv.FormatFloat(v, 'f', -1, 64))
			} else {
				row = append(row, "")
			}
		}
		w.Write(row)
	}
	fx := []string{"匯率(對 " + base + ")", "", "", ""}
	for _, d := range dates {
		if v, ok := fxByDate[d]; ok {
			fx = append(fx, strconv.FormatFloat(v, 'f', -1, 64))
		} else {
			fx = append(fx, "")
		}
	}
	w.Write(fx)
	for _, k := range []string{"bank", "tw_stock", "us_stock", "movable", "real_estate", "crypto", "liability"} {
		row := []string{"小計 " + kindLabel[k] + "(" + base + ")", "", base, ""}
		nonzero := false
		for _, r := range totals {
			v := r.ByKind[k]
			nonzero = nonzero || v != 0
			row = append(row, fmt.Sprintf("%.0f", v))
		}
		if nonzero {
			w.Write(row)
		}
	}
	net := []string{"淨資產(" + base + ")", "", base, ""}
	for _, r := range totals {
		net = append(net, fmt.Sprintf("%.0f", r.Total))
	}
	w.Write(net)
	w.Flush()
	return buf.Bytes(), w.Error()
}
