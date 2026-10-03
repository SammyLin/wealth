package ledger

import (
	"bytes"
	"cmp"
	"database/sql"
	"encoding/csv"
	"encoding/json"
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

// Each missing fx is one outbound fetch, and a Worker request has a few dozen subrequests on the free plan.
const maxFXLookups = 30

type importRow struct {
	line           int
	date, account  string
	amount, fx     float64 // fx 0 = look it up
	kind, currency string  // optional columns: defaults for an account the import would create
}

// rowErrs collects row problems by message, so a column of bad dates reads "第 2、5、9 列…" in one message
// instead of stopping at the first row.
type rowErrs struct {
	keys  []string
	lines map[string][]string
}

func (e *rowErrs) add(key string, line int) {
	if e.lines == nil {
		e.lines = map[string][]string{}
	}
	if _, ok := e.lines[key]; !ok {
		e.keys = append(e.keys, key)
	}
	e.lines[key] = append(e.lines[key], strconv.Itoa(line))
}

func (e *rowErrs) list() []*userErr {
	var out []*userErr
	for _, k := range e.keys {
		lines := e.lines[k]
		if len(lines) > 10 {
			lines = append(lines[:10:10], "…")
		}
		out = append(out, errf(k, lines))
	}
	return out
}

// parseImport reads the long layout `date,account,amount[,fx][,kind][,currency]` (the header decides column
// order; a BOM from Excel is dropped; rows with every cell blank, which spreadsheets append, are skipped).
// Amounts take the same shorthand as the record dialog (1,234 / 12.5萬 / 3k). A file-level problem comes back
// alone with no rows; otherwise every bad row is reported and the good rows still come back for the preview.
func parseImport(b []byte) ([]importRow, []*userErr) {
	one := func(key string, params ...any) ([]importRow, []*userErr) {
		return nil, []*userErr{errf(key, params...)}
	}
	b = bytes.TrimPrefix(b, []byte("\xef\xbb\xbf"))
	if !utf8.Valid(b) {
		return one("檔案不是 UTF-8 編碼,請在 Excel 另存成「CSV UTF-8」")
	}
	r := csv.NewReader(bytes.NewReader(b))
	r.FieldsPerRecord = -1
	r.TrimLeadingSpace = true
	head, err := r.Read()
	if err != nil {
		return one("CSV 是空的或格式錯誤")
	}
	col := map[string]int{}
	for i, h := range head {
		col[strings.ToLower(strings.TrimSpace(h))] = i + 1 // 0 = no such column
	}
	if col["date"] == 0 || col["account"] == 0 || col["amount"] == 0 {
		if len(head) == 1 && strings.Contains(head[0], ";") {
			return one("這個檔案用分號分隔,請改成逗號分隔的 CSV")
		}
		return one("第一列要是標題:date,account,amount,fx(fx 可省略)")
	}
	field := func(rec []string, name string) string {
		if i := col[name] - 1; i >= 0 && i < len(rec) {
			return strings.TrimSpace(rec[i])
		}
		return ""
	}
	var out []importRow
	var errs rowErrs
	seen := map[[2]string]bool{}
	for {
		rec, err := r.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if pe := (*csv.ParseError)(nil); errors.As(err, &pe) {
			return one("第 {} 列格式錯誤", pe.StartLine)
		} else if err != nil {
			return one("CSV 是空的或格式錯誤")
		}
		if strings.TrimSpace(strings.Join(rec, "")) == "" {
			continue
		}
		line, _ := r.FieldPos(0) // the spreadsheet's row number, blank lines included
		row := importRow{line: line, date: field(rec, "date"), account: unescapeCell(field(rec, "account")), kind: field(rec, "kind"), currency: field(rec, "currency")}
		if !validDate(row.date) {
			errs.add("第 {} 列的日期不正確,要是 YYYY-MM-DD", line)
			continue
		}
		if row.account == "" {
			errs.add("第 {} 列沒有帳戶名稱", line)
			continue
		}
		if utf8.RuneCountInString(row.account) > maxName {
			errs.add("第 {} 列的帳戶名稱太長,最多 60 字", line)
			continue
		}
		if futureDate(row.date) {
			errs.add("第 {} 列的日期在未來", line)
			continue
		}
		row.amount = parseAmount(field(rec, "amount"))
		if math.Abs(row.amount) > maxAmount || math.IsNaN(row.amount) {
			errs.add("第 {} 列的金額不是數字", line)
			continue
		}
		if s := field(rec, "fx"); s != "" {
			if row.fx, err = strconv.ParseFloat(s, 64); err != nil || !(row.fx > 0 && row.fx <= maxFX) {
				errs.add("第 {} 列的匯率不正確", line)
				continue
			}
		}
		key := [2]string{nameKey(row.account), row.date}
		if seen[key] {
			errs.add("第 {} 列和前面重複:同一個帳戶同一天只能有一筆", line)
			continue
		}
		seen[key] = true
		if out = append(out, row); len(out) > maxBatchRows {
			return one("一次最多匯入 {} 筆,請分批", maxBatchRows)
		}
	}
	if len(out) == 0 && len(errs.keys) == 0 {
		return one("CSV 沒有資料列")
	}
	return out, errs.list()
}

var (
	amountRe  = regexp.MustCompile(`^([+-]?(?:\d+\.?\d*|\.\d+))(萬|万|億|亿|千|k|m|b)?$`)
	groupedRe = regexp.MustCompile(`^[+-]?\d{1,3}(,\d{3})+(\.\d*)?(萬|万|億|亿|千|k|m|b)?$`)
	unitOf    = map[string]float64{"萬": 1e4, "万": 1e4, "億": 1e8, "亿": 1e8, "千": 1e3, "k": 1e3, "m": 1e6, "b": 1e9}
)

// parseAmount mirrors parseAmount in web/src/lib/format.ts: "1,234,567", "12.5萬", "3k", "−500", full-width digits.
// Commas must be thousands separators, so "1.234,56" is rejected instead of read as 1.23456. NaN if not a number.
// testdata/amounts.json holds the cases both implementations are tested against.
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
		case r == ' ' || r == '　' || r == '_':
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

// newAccount is a name the CSV uses that no account has yet, with the file's kind and currency cells
// (raw, possibly empty) as defaults for the account the UI offers to create.
type newAccount struct {
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	Currency string `json:"currency"`
}

// previewRow is one good row as ?dry_run=1 reports it.
type previewRow struct {
	Line       int     `json:"line"`
	Date       string  `json:"date"`
	Account    string  `json:"account"`
	Amount     float64 `json:"amount"`
	FX         float64 `json:"fx"`         // 0 = looked up on import (or 1 for a base-currency account)
	Currency   string  `json:"currency"`   // the account's (or the picked one for an account the import creates); "" if unknown
	Overwrites bool    `json:"overwrites"` // replaces a balance already recorded that day
}

// fxSince is the first day the FX source has rates for (fetchFX); an earlier date can't be looked up.
const fxSince = "2024-03-02"

// nameKey is how the import matches account names: trimmed and case-folded, like nameFreeSQL's lower(),
// so a CSV row for "schwab" lands on the account "Schwab" instead of asking to create a duplicate.
func nameKey(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

// importBalances is POST /api/import (text/csv). Names with no account are created when the query carries
// ?accounts=[{name,kind,currency}] for them (the UI's pickers); any other unknown name is a 400.
// Everything is validated and every missing fx looked up before the first write, so a bad file or an FX
// outage changes nothing. With ?dry_run=1 nothing is written or fetched: the answer is
// {rows, unknown_accounts, errors} for the UI's preview, so the preview and the import can't disagree.
func (h *api) importBalances(c *gin.Context) {
	ctx, db := c.Request.Context(), h.db
	dry := c.Query("dry_run") == "1"
	var picked []newAccount
	if s := c.Query("accounts"); s != "" && json.Unmarshal([]byte(s), &picked) != nil {
		bad(c, http.StatusBadRequest, "格式不正確")
		return
	}
	body, err := io.ReadAll(c.Request.Body) // guardWrites caps it at maxBody
	if err != nil {
		bad(c, http.StatusBadRequest, "檔案讀取失敗或超過 1 MB")
		return
	}
	rows, errs := parseImport(body)
	parseErrs := len(errs)

	type acct struct {
		id  int64 // 0 = created by this import
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
		k := nameKey(name)
		if _, seen := byName[k]; seen {
			dup[k] = true // from before names had to be unique
		}
		byName[k] = a
		return nil
	})
	if fail(c, err) {
		return
	}
	set, err := settings(ctx, db)
	if fail(c, err) {
		return
	}
	kinds, err := listKinds(ctx, db)
	if fail(c, err) {
		return
	}
	known := kindMap(kinds)
	base := set["base_currency"]
	pick := map[string]newAccount{}
	for _, p := range picked {
		pick[nameKey(p.Name)] = p
	}

	type match struct {
		importRow
		key string
		acct
	}
	var matched []match
	unknown, create := []newAccount{}, []newAccount{}
	var unpicked, badPick, ambiguous, baseFX, early []string
	need := map[string]bool{}
	for _, r := range rows {
		k := nameKey(r.account)
		a, ok := byName[k]
		if !ok {
			i := slices.IndexFunc(unknown, func(u newAccount) bool { return nameKey(u.Name) == k })
			if i < 0 {
				unknown, i = append(unknown, newAccount{Name: r.account}), len(unknown)
			}
			u := &unknown[i]
			u.Kind, u.Currency = cmp.Or(u.Kind, r.kind), cmp.Or(u.Currency, r.currency) // the first non-empty cell wins
			p, has := pick[k]
			switch {
			case !has:
				if !slices.Contains(unpicked, u.Name) {
					unpicked = append(unpicked, u.Name)
				}
				continue
			case known[p.Kind].Key == "" || !validCurrency(p.Currency):
				if !slices.Contains(badPick, u.Name) {
					badPick = append(badPick, u.Name)
				}
				continue
			}
			a = acct{cur: strings.ToUpper(p.Currency)}
			if !slices.ContainsFunc(create, func(n newAccount) bool { return nameKey(n.Name) == k }) {
				create = append(create, newAccount{Name: u.Name, Kind: p.Kind, Currency: a.cur})
			}
		}
		if dup[k] && !slices.Contains(ambiguous, r.account) {
			ambiguous = append(ambiguous, r.account)
		}
		if r.fx == 0 && a.cur != base {
			need[a.cur+" "+r.date] = true
			if r.date < fxSince && !slices.Contains(early, r.date) {
				early = append(early, r.date)
			}
		}
		// a stray fx column on base-currency rows would silently multiply them
		if a.cur == base && r.fx != 0 && r.fx != 1 && !slices.Contains(baseFX, r.account) {
			baseFX = append(baseFX, r.account)
		}
		matched = append(matched, match{r, k, a})
	}
	slices.SortFunc(unknown, func(a, b newAccount) int { return strings.Compare(a.Name, b.Name) })
	sorted := func(s []string) []string {
		slices.Sort(s)
		if len(s) > 10 {
			s = append(s[:10:10], "…")
		}
		return s
	}
	if len(badPick) > 0 {
		errs = append(errs, errf("這些新帳戶的類別或幣別不正確:{}", sorted(badPick)))
	}
	if len(ambiguous) > 0 {
		errs = append(errs, errf("有好幾個帳戶叫這些名字,請先改成不同的名字:{}", sorted(ambiguous)))
	}
	if len(baseFX) > 0 {
		errs = append(errs, errf("這些帳戶是基準幣別,fx 要留空或填 1:{}", sorted(baseFX)))
	}
	if len(early) > 0 {
		errs = append(errs, errf("匯率資料從 {} 開始,這些日期查不到匯率,請在 CSV 填 fx:{}", fxSince, sorted(early)))
	}
	if len(need) > maxFXLookups {
		errs = append(errs, errf("有 {} 組幣別和日期要查匯率,一次最多 {} 組,請在 CSV 填 fx 欄", len(need), maxFXLookups))
	}

	if dry {
		// ponytail: loads every snapshot key to flag overwrites; fine for a household ledger's few thousand rows
		recorded := map[Snapshot]bool{}
		err := queryEach(ctx, db, `SELECT account_id, date FROM snapshots`, func(r *sql.Rows) error {
			var s Snapshot
			err := r.Scan(&s.AccountID, &s.Date)
			recorded[s] = true
			return err
		})
		if fail(c, err) {
			return
		}
		at := map[int]acct{}
		for _, m := range matched {
			at[m.line] = m.acct
		}
		preview, msgs := []previewRow{}, []gin.H{}
		for _, r := range rows {
			p := previewRow{Line: r.line, Date: r.date, Account: r.account, Amount: r.amount, FX: r.fx}
			if a, ok := at[r.line]; ok {
				p.Currency, p.Overwrites = a.cur, a.id != 0 && recorded[Snapshot{AccountID: a.id, Date: r.date}]
			}
			preview = append(preview, p)
		}
		for _, e := range errs {
			msgs = append(msgs, e.body())
		}
		c.JSON(http.StatusOK, gin.H{"rows": preview, "unknown_accounts": unknown, "errors": msgs, "fx_lookups": len(need)})
		return
	}

	if parseErrs == 0 && len(unpicked) > 0 {
		bad(c, http.StatusBadRequest, "找不到這些帳戶:{}", sorted(unpicked))
		return
	}
	if len(errs) > 0 {
		bad(c, http.StatusBadRequest, errs[0].key, errs[0].params...)
		return
	}

	// Every rate first: an FX outage must fail the import before any account or balance is written.
	rates := map[string]float64{}
	for i := range matched {
		m := &matched[i]
		if m.fx != 0 {
			continue
		}
		m.fx = 1
		if m.cur != base {
			k := m.cur + " " + m.date
			if rates[k] == 0 {
				if rates[k], err = fetchFX(ctx, m.cur, base, m.date); err != nil {
					bad(c, http.StatusBadGateway, "查不到 {} 在 {} 的匯率,請在 CSV 填 fx", m.cur, m.date)
					return
				}
			}
			m.fx = rates[k]
		}
	}
	// ponytail: no transactions on D1, so a name taken between the checks and here (another tab) stops the
	// import with the accounts made so far kept; running it again reuses them.
	created := map[string]int64{}
	for _, n := range create {
		a := Account{Name: n.Name, Kind: n.Kind, Currency: n.Currency}
		ok, err := insertAccount(ctx, db, &a)
		if fail(c, err) {
			return
		}
		if !ok {
			h.rejectAccount(c, &a.Kind, &a.Name, 0)
			return
		}
		created[nameKey(n.Name)] = a.ID
	}
	snaps := make([]Snapshot, 0, len(matched))
	for _, m := range matched {
		id := m.id
		if id == 0 {
			id = created[m.key]
		}
		s := Snapshot{AccountID: id, Date: m.date, Amount: m.amount, FX: m.fx}
		if !validSnapshot(s) {
			bad(c, http.StatusBadRequest, "日期、金額或匯率不正確")
			return
		}
		snaps = append(snaps, s)
	}
	if fail(c, upsertSnapshots(ctx, db, snaps)) {
		return
	}
	c.JSON(http.StatusOK, gin.H{"imported": len(snaps), "created": len(create)})
}
