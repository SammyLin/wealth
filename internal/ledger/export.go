package ledger

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/csv"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// export is GET /api/export.csv: ?layout=long is the date,account,amount,fx layout POST /api/import reads back;
// otherwise the wide spreadsheet layout, labelled in English with ?lang=en.
func (h *api) export(c *gin.Context) {
	var b []byte
	var err error
	name := "wealth"
	if c.Query("layout") == "long" {
		b, err = exportLong(c.Request.Context(), h.db)
		name = "wealth-balances"
	} else {
		b, err = exportCSV(c.Request.Context(), h.db, c.Query("lang") == "en")
	}
	if fail(c, err) {
		return
	}
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s-%s.csv"`, name, time.Now().Format("2006-01-02")))
	c.Data(http.StatusOK, "text/csv; charset=utf-8", b)
}

// escapeCell stops a spreadsheet from running a cell as a formula (CSV injection): a leading = + - @
// gets a ' in front, which Excel shows as plain text. unescapeCell undoes it on import. A leading '
// is escaped too, so a name that really starts with ' survives the round trip.
const escapedLead = "=+-@\t\r'"

func escapeCell(s string) string {
	if s != "" && strings.ContainsRune(escapedLead, rune(s[0])) {
		return "'" + s
	}
	return s
}

func unescapeCell(s string) string {
	if len(s) > 1 && s[0] == '\'' && strings.ContainsRune(escapedLead, rune(s[1])) {
		return s[1:]
	}
	return s
}

// exportLabels are the wide layout's fixed cells; ?lang=en switches them.
var exportLabels = map[bool]map[string]string{
	false: {"account": "帳戶", "kind": "類別", "currency": "幣別", "archived": "封存", "yes": "是", "fx": "匯率 %s(對 %s)", "subtotal": "小計 %s(%s)", "net": "淨資產(%s)"},
	true:  {"account": "Account", "kind": "Class", "currency": "Currency", "archived": "Archived", "yes": "yes", "fx": "Rate %s (to %s)", "subtotal": "Subtotal %s (%s)", "net": "Net worth (%s)"},
}

// seededKindEn names migration 0002's kinds in English (the same words as the UI's i18n/en.ts), for ?lang=en.
// A kind the user renamed keeps its own name.
var seededKindEn = map[string]string{"銀行": "Bank", "台股": "TW stocks", "美股": "US stocks", "加密貨幣": "Crypto", "動產": "Personal property", "不動產": "Real estate", "負債": "Liabilities"}

// exportLong writes date,account,amount,fx,kind,currency: the layout POST /api/import reads, so an export
// re-imports as is, and into an empty ledger the kind and currency columns preset each account it creates.
func exportLong(ctx context.Context, db *sql.DB) ([]byte, error) {
	var buf bytes.Buffer
	buf.WriteString("\xef\xbb\xbf")
	w := csv.NewWriter(&buf)
	w.Write([]string{"date", "account", "amount", "fx", "kind", "currency"})
	err := queryEach(ctx, db, `SELECT s.date, a.name, s.amount, s.fx, a.kind, a.currency FROM snapshots s JOIN accounts a ON a.id = s.account_id ORDER BY s.date, a.sort, a.id`, func(r *sql.Rows) error {
		var date, name, kind, cur string
		var amount, fx float64
		if err := r.Scan(&date, &name, &amount, &fx, &kind, &cur); err != nil {
			return err
		}
		return w.Write([]string{date, escapeCell(name), strconv.FormatFloat(amount, 'f', -1, 64), strconv.FormatFloat(fx, 'f', -1, 64), kind, cur})
	})
	if err != nil {
		return nil, fmt.Errorf("export long: %w", err)
	}
	w.Flush()
	return buf.Bytes(), w.Error()
}

// exportCSV writes a spreadsheet-friendly layout: one row per account,
// one column per snapshot date, balances in the account's own currency, plus totals in the base currency.
// A UTF-8 BOM makes Excel read the Chinese correctly.
func exportCSV(ctx context.Context, db *sql.DB, en bool) ([]byte, error) {
	L := exportLabels[en]
	kinds, err := listKinds(ctx, db)
	if err != nil {
		return nil, err
	}
	if en {
		for i, k := range kinds {
			if n, ok := seededKindEn[k.Name]; ok {
				kinds[i].Name = n
			}
		}
	}
	byKey := kindMap(kinds)
	type acct struct {
		id              int64
		name, kind, cur string
		archived        bool
	}
	var accts []acct
	rows, err := db.QueryContext(ctx, `SELECT id, name, kind, currency, archived FROM accounts ORDER BY sort, id`)
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
	curOf := map[int64]string{}
	for _, a := range accts {
		curOf[a.id] = a.cur
	}
	fx := map[string]map[string]float64{} // currency → date → rate (last account by id wins on a tie)
	rows, err = db.QueryContext(ctx, `SELECT account_id, date, amount, fx FROM snapshots ORDER BY date, account_id`)
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
		if cur := curOf[s.AccountID]; s.FX != 1 {
			if fx[cur] == nil {
				fx[cur] = map[string]float64{}
			}
			fx[cur][s.Date] = s.FX
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("export snapshots: %w", err)
	}

	totals := series(snaps, kindOf, byKey)
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
	w.Write(append([]string{L["account"], L["kind"], L["currency"], L["archived"]}, dates...))
	for _, a := range accts {
		row := []string{escapeCell(a.name), escapeCell(byKey[a.kind].Name), a.cur, map[bool]string{true: L["yes"], false: ""}[a.archived]}
		for _, d := range dates {
			if v, ok := vals[a.id][d]; ok {
				row = append(row, strconv.FormatFloat(v, 'f', -1, 64))
			} else {
				row = append(row, "")
			}
		}
		w.Write(row)
	}
	curs := make([]string, 0, len(fx))
	for cur := range fx {
		curs = append(curs, cur)
	}
	sort.Strings(curs)
	for _, cur := range curs { // one rate row per foreign currency
		row := []string{fmt.Sprintf(L["fx"], cur, base), "", cur, ""}
		for _, d := range dates {
			if v, ok := fx[cur][d]; ok {
				row = append(row, strconv.FormatFloat(v, 'f', -1, 64))
			} else {
				row = append(row, "")
			}
		}
		w.Write(row)
	}
	for _, k := range kinds {
		row := []string{escapeCell(fmt.Sprintf(L["subtotal"], k.Name, base)), "", base, ""}
		nonzero := false
		for _, r := range totals {
			v := r.ByKind[k.Key]
			nonzero = nonzero || v != 0
			row = append(row, fmt.Sprintf("%.0f", v))
		}
		if nonzero {
			w.Write(row)
		}
	}
	net := []string{fmt.Sprintf(L["net"], base), "", base, ""}
	for _, r := range totals {
		net = append(net, fmt.Sprintf("%.0f", r.Total))
	}
	w.Write(net)
	w.Flush()
	return buf.Bytes(), w.Error()
}
