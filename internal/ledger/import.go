package ledger

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/csv"
	"errors"
	"io"
	"math"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

const (
	maxImportBytes = 1 << 20
	// A Worker request is capped at a few dozen subrequests on the free plan; each 20 rows is one D1 statement
	// and each missing fx one outbound fetch, so both are capped instead of risking a half-applied import.
	maxImportRows = 1000
	maxFXLookups  = 30
)

type importRow struct {
	date, account string
	amount, fx    float64 // fx 0 = look it up
}

// userErr is a 400 message for bad(): a Chinese template with {} holes plus its values.
type userErr struct {
	key    string
	params []any
}

func errf(key string, params ...any) *userErr { return &userErr{key, params} }

// parseImport reads the long layout `date,account,amount[,fx]` (the header decides column order;
// a BOM from Excel is dropped). Amounts take the same shorthand as the record dialog (1,234 / 12.5萬 / 3k).
func parseImport(b []byte) ([]importRow, *userErr) {
	b = bytes.TrimPrefix(b, []byte("\xef\xbb\xbf"))
	if !utf8.Valid(b) {
		return nil, errf("檔案不是 UTF-8 編碼,請在 Excel 另存成「CSV UTF-8」")
	}
	r := csv.NewReader(bytes.NewReader(b))
	r.FieldsPerRecord = -1
	r.TrimLeadingSpace = true
	head, err := r.Read()
	if err != nil {
		return nil, errf("CSV 是空的或格式錯誤")
	}
	col := map[string]int{}
	for i, h := range head {
		col[strings.ToLower(strings.TrimSpace(h))] = i
	}
	di, dok := col["date"]
	ai, aok := col["account"]
	mi, mok := col["amount"]
	if !dok || !aok || !mok {
		if len(head) == 1 && strings.Contains(head[0], ";") {
			return nil, errf("這個檔案用分號分隔,請改成逗號分隔的 CSV")
		}
		return nil, errf("第一列要是標題:date,account,amount,fx(fx 可省略)")
	}
	fi, fok := col["fx"]
	field := func(rec []string, i int) string {
		if i < len(rec) {
			return strings.TrimSpace(rec[i])
		}
		return ""
	}
	var out []importRow
	for line := 2; ; line++ {
		rec, err := r.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, errf("第 {} 列格式錯誤", line)
		}
		row := importRow{date: field(rec, di), account: unescapeCell(field(rec, ai))}
		if !validDate(row.date) || row.account == "" {
			return nil, errf("第 {} 列的日期(YYYY-MM-DD)或帳戶名稱不正確", line)
		}
		if futureDate(row.date) {
			return nil, errf("第 {} 列的日期在未來", line)
		}
		row.amount = parseAmount(field(rec, mi))
		if math.Abs(row.amount) > maxAmount || math.IsNaN(row.amount) {
			return nil, errf("第 {} 列的金額不是數字", line)
		}
		if s := field(rec, fi); fok && s != "" {
			if row.fx, err = strconv.ParseFloat(s, 64); err != nil || !(row.fx > 0 && row.fx <= maxFX) {
				return nil, errf("第 {} 列的匯率不正確", line)
			}
		}
		if out = append(out, row); len(out) > maxImportRows {
			return nil, errf("一次最多匯入 {} 筆,請分批", maxImportRows)
		}
	}
	if len(out) == 0 {
		return nil, errf("CSV 沒有資料列")
	}
	return out, nil
}

var (
	amountRe  = regexp.MustCompile(`^([+-]?(?:\d+\.?\d*|\.\d+))(萬|万|億|亿|千|k|m|b)?$`)
	groupedRe = regexp.MustCompile(`^[+-]?\d{1,3}(,\d{3})+(\.\d*)?(萬|万|億|亿|千|k|m|b)?$`)
	unitOf    = map[string]float64{"萬": 1e4, "万": 1e4, "億": 1e8, "亿": 1e8, "千": 1e3, "k": 1e3, "m": 1e6, "b": 1e9}
)

// parseAmount mirrors parseAmount in web/src/lib/format.ts: "1,234,567", "12.5萬", "3k", "−500", full-width digits.
// Commas must be thousands separators, so "1.234,56" is rejected instead of read as 1.23456. NaN if not a number.
func parseAmount(s string) float64 {
	s = strings.Map(func(r rune) rune {
		switch {
		case r >= '０' && r <= '９':
			return '0' + r - '０'
		case r == '，':
			return ','
		case r == '．':
			return '.'
		case r == '－' || r == '−' || r == '–':
			return '-'
		case r == ' ' || r == '\u3000' || r == '_':
			return -1
		}
		return unicode.ToLower(r)
	}, s)
	for _, cut := range []string{"nt$", "$", "元"} {
		s = strings.ReplaceAll(s, cut, "")
	}
	if strings.Contains(s, ",") {
		if !groupedRe.MatchString(s) {
			return math.NaN()
		}
		s = strings.ReplaceAll(s, ",", "")
	}
	m := amountRe.FindStringSubmatch(s)
	if m == nil {
		return math.NaN()
	}
	v, err := strconv.ParseFloat(m[1], 64)
	if err != nil {
		return math.NaN()
	}
	if m[2] != "" {
		v *= unitOf[m[2]]
	}
	return math.Round(v*1e6) / 1e6
}

// importBalances is POST /api/import. Everything is validated and every missing fx looked up
// before the first write, so a bad file changes nothing.
func importBalances(c *gin.Context, db *sql.DB) {
	ctx := c.Request.Context()
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, maxImportBytes))
	if err != nil {
		bad(c, http.StatusBadRequest, "檔案讀取失敗或超過 1 MB")
		return
	}
	rows, perr := parseImport(body)
	if perr != nil {
		bad(c, http.StatusBadRequest, perr.key, perr.params...)
		return
	}

	type acct struct {
		id  int64
		cur string
	}
	byName := map[string]acct{}
	dup := map[string]bool{}
	err = queryEach(ctx, db, `SELECT id, name, currency FROM accounts`, func(r *sql.Rows) error {
		var a acct
		var name string
		if err := r.Scan(&a.id, &name, &a.cur); err != nil {
			return err
		}
		if _, seen := byName[name]; seen {
			dup[name] = true
		}
		byName[name] = a
		return nil
	})
	if fail(c, err) {
		return
	}
	var unknown, ambiguous []string
	for _, r := range rows {
		if _, ok := byName[r.account]; !ok && !slices.Contains(unknown, r.account) {
			unknown = append(unknown, r.account)
		}
		if dup[r.account] && !slices.Contains(ambiguous, r.account) {
			ambiguous = append(ambiguous, r.account)
		}
	}
	if len(unknown) > 0 {
		slices.Sort(unknown)
		bad(c, http.StatusBadRequest, "找不到這些帳戶:{}", unknown)
		return
	}
	if len(ambiguous) > 0 {
		slices.Sort(ambiguous)
		bad(c, http.StatusBadRequest, "有好幾個帳戶叫這些名字,請先改成不同的名字:{}", ambiguous)
		return
	}

	set, err := settings(ctx, db)
	if fail(c, err) {
		return
	}
	need := map[string]bool{}
	var baseFX []string
	for _, r := range rows {
		a := byName[r.account]
		if r.fx == 0 && a.cur != set["base_currency"] {
			need[a.cur+" "+r.date] = true
		}
		// a stray fx column on base-currency rows would silently multiply them
		if a.cur == set["base_currency"] && r.fx != 0 && r.fx != 1 && !slices.Contains(baseFX, r.account) {
			baseFX = append(baseFX, r.account)
		}
	}
	if len(baseFX) > 0 {
		slices.Sort(baseFX)
		bad(c, http.StatusBadRequest, "這些帳戶是基準幣別,fx 要留空或填 1:{}", baseFX)
		return
	}
	if len(need) > maxFXLookups {
		bad(c, http.StatusBadRequest, "有 {} 組幣別和日期要查匯率,一次最多 {} 組,請在 CSV 填 fx 欄", len(need), maxFXLookups)
		return
	}
	rates := map[string]float64{}
	index := map[Snapshot]int{} // keyed without amount/fx: the same account+date twice keeps the last row
	var snaps []Snapshot
	for _, r := range rows {
		a := byName[r.account]
		if r.fx == 0 {
			r.fx = 1
			if a.cur != set["base_currency"] {
				k := a.cur + " " + r.date
				if rates[k] == 0 {
					if rates[k], err = fetchFX(ctx, a.cur, set["base_currency"], r.date); err != nil {
						bad(c, http.StatusBadGateway, "查不到 {} 在 {} 的匯率,請在 CSV 填 fx", a.cur, r.date)
						return
					}
				}
				r.fx = rates[k]
			}
		}
		s := Snapshot{AccountID: a.id, Date: r.date, Amount: r.amount, FX: r.fx}
		if !validSnapshot(s) {
			bad(c, http.StatusBadRequest, "日期、金額或匯率不正確")
			return
		}
		key := Snapshot{AccountID: a.id, Date: r.date}
		if i, ok := index[key]; ok {
			snaps[i] = s
			continue
		}
		index[key] = len(snaps)
		snaps = append(snaps, s)
	}
	if fail(c, upsertSnapshots(ctx, db, snaps)) {
		return
	}
	c.JSON(http.StatusOK, gin.H{"imported": len(snaps)})
}

// upsertSnapshots writes rows in multi-row statements of 20 (4 params each; D1 caps a statement at 100).
// No transaction on D1, but an upsert is idempotent, so retrying after a partial failure is safe.
func upsertSnapshots(ctx context.Context, db *sql.DB, in []Snapshot) error {
	for i := 0; i < len(in); i += 20 {
		chunk := in[i:min(i+20, len(in))]
		args := make([]any, 0, len(chunk)*4)
		for _, s := range chunk {
			args = append(args, s.AccountID, s.Date, s.Amount, s.FX)
		}
		q := `INSERT INTO snapshots (account_id, date, amount, fx) VALUES ` +
			strings.TrimSuffix(strings.Repeat("(?, ?, ?, ?),", len(chunk)), ",") +
			` ON CONFLICT(account_id, date) DO UPDATE SET amount=excluded.amount, fx=excluded.fx`
		if _, err := db.ExecContext(ctx, q, args...); err != nil {
			return err
		}
	}
	return nil
}
