//go:build !js

package ledger

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

type dryRun struct {
	Rows    []previewRow
	Unknown []newAccount `json:"unknown_accounts"`
	Errors  []struct {
		Error  string
		Key    string
		Params []any
	}
}

func preview(t *testing.T, r *gin.Engine, csv string) dryRun {
	t.Helper()
	return previewWith(t, r, csv, "")
}

// previewWith passes ?accounts= (the accounts the UI's pickers would create), as JSON.
func previewWith(t *testing.T, r *gin.Engine, csv, accounts string) dryRun {
	t.Helper()
	var d dryRun
	w := call(t, r, "POST", "/api/import?dry_run=1&accounts="+url.QueryEscape(accounts), "text/csv", csv, &d)
	wantStatus(t, w, 200)
	return d
}

func errorsOf(d dryRun) string {
	var out []string
	for _, e := range d.Errors {
		out = append(out, e.Error)
	}
	return strings.Join(out, "|")
}

// The main flow a household goes through, end to end on one router: first account, a record, a spreadsheet
// import that creates the accounts it names, an edit, the dashboard state and the export.
func TestMainFlow(t *testing.T) {
	r, _ := newTestRouter(t)
	var a Account
	wantStatus(t, callJSON(t, r, "POST", "/api/accounts", `{"name":"薪轉戶","kind":"bank"}`, &a), 201)
	wantStatus(t, callJSON(t, r, "POST", "/api/snapshots", `[{"account_id":`+jsonID(a.ID)+`,"date":"2026-01-01","amount":1000,"fx":1}]`, nil), 204)

	// a migrating household's sheet: one known account, two new ones with kind/currency defaults, Excel's ,,, tail
	csv := "date,account,amount,fx,kind,currency\n" +
		"2026-01-01,薪轉戶,1200,,,\n" +
		"2026-01-01,房貸,500,,liability,\n" +
		"2026-01-01,Wise,10,30,,usd\n" +
		"2026-02-01,房貸,480,,,\n" +
		",,,,,\n   \n"
	d := preview(t, r, csv)
	if len(d.Errors) != 0 || len(d.Rows) != 4 {
		t.Fatalf("preview: %+v", d)
	}
	if !d.Rows[0].Overwrites || d.Rows[0].Currency != "TWD" || d.Rows[1].Currency != "" {
		t.Errorf("preview rows: %+v", d.Rows)
	}
	if len(d.Unknown) != 2 || d.Unknown[0] != (newAccount{"Wise", "", "usd"}) || d.Unknown[1] != (newAccount{"房貸", "liability", ""}) {
		t.Fatalf("unknown: %+v", d.Unknown)
	}
	// without the accounts the import itself refuses, naming them
	var e struct{ Error string }
	wantStatus(t, call(t, r, "POST", "/api/import", "text/csv", csv, &e), 400)
	if e.Error != "找不到這些帳戶:Wise、房貸" {
		t.Fatalf("import before creating: %q", e.Error)
	}
	// what the UI does on Import: one request naming the accounts to create with the picked class and currency
	picks := `[{"name":"房貸","kind":"liability","currency":"TWD"},{"name":"Wise","kind":"bank","currency":"USD"}]`
	if d := previewWith(t, r, csv, picks); len(d.Errors) != 0 || d.Rows[1].Currency != "TWD" || d.Rows[2].Currency != "USD" {
		t.Fatalf("preview with picks: %+v", d)
	}
	var out struct{ Imported, Created int }
	wantStatus(t, call(t, r, "POST", "/api/import?accounts="+url.QueryEscape(picks), "text/csv", csv, &out), 200)
	if out.Imported != 4 || out.Created != 2 {
		t.Fatalf("imported %d, created %d", out.Imported, out.Created)
	}
	if d := preview(t, r, csv); len(d.Unknown) != 0 || len(d.Errors) != 0 {
		t.Fatalf("preview after importing: %+v", d)
	}
	wantStatus(t, callJSON(t, r, "PATCH", "/api/accounts/"+jsonID(a.ID), `{"note":"薪資"}`, nil), 204)

	var st struct {
		Accounts []Account
		Series   []Row
	}
	wantStatus(t, callJSON(t, r, "GET", "/api/state?today=2026-02-15", "", &st), 200)
	if len(st.Accounts) != 3 || st.Accounts[0].Note != "薪資" || len(st.Series) != 2 || st.Series[0].Total != 1200-500+300 || st.Series[1].Total != 1200-480+300 {
		t.Fatalf("state: %+v %+v", st.Accounts, st.Series)
	}
	long := callJSON(t, r, "GET", "/api/export.csv?layout=long", "", nil).Body.String()
	if strings.Count(long, "\n") != 5 || !strings.Contains(long, "2026-02-01,房貸,480,1") {
		t.Fatalf("long export:\n%s", long)
	}
}

func TestImportPreviewReportsEveryProblem(t *testing.T) {
	r, db := newTestRouter(t)
	wantStatus(t, callJSON(t, r, "POST", "/api/accounts", `{"name":"A","kind":"bank"}`, nil), 201)
	// rows 3 and 5 share a bad date, row 4 repeats row 2 (in another case), row 6 has fx on a base-currency
	// account, row 7 has no account name
	csv := "date,account,amount,fx\n2026-01-01,A,1,\n01/02/2026,A,2,\n2026-01-01,a,3,\n2026/01/03,A,4,\n2026-01-04,A,5,7\n2026-01-05,,6,\n"
	d := preview(t, r, csv)
	got := []string{}
	for _, e := range d.Errors {
		got = append(got, e.Error)
	}
	want := []string{"第 3、5 列的日期不正確,要是 YYYY-MM-DD", "第 4 列和前面重複:同一個帳戶同一天只能有一筆", "第 7 列沒有帳戶名稱", "這些帳戶是基準幣別,fx 要留空或填 1:A"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("errors %q", got)
	}
	if len(d.Rows) != 2 {
		t.Errorf("good rows still previewed: %+v", d.Rows)
	}
	if e := d.Errors[0]; e.Key != "第 {} 列的日期不正確,要是 YYYY-MM-DD" || len(e.Params) != 1 {
		t.Errorf("translatable key/params: %+v", e)
	}
	// the import refuses with the first problem and writes nothing
	var e struct{ Error string }
	wantStatus(t, call(t, r, "POST", "/api/import", "text/csv", csv, &e), 400)
	if e.Error != want[0] {
		t.Errorf("import error %q", e.Error)
	}
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM snapshots`).Scan(&n)
	if n != 0 {
		t.Fatalf("%d rows written", n)
	}
	// a file-level problem comes back alone in the preview, and Big5 bytes get the encoding hint
	if d := preview(t, r, "date,account,amount\n2026-01-01,\xb0\xea,1\n"); len(d.Errors) != 1 || !strings.Contains(d.Errors[0].Error, "UTF-8") || len(d.Rows) != 0 {
		t.Errorf("big5: %+v", d)
	}
	// blank and whitespace-only rows (Excel's ,,, tail) are skipped by both
	blank := "date,account,amount,fx\n2026-10-03,\"A\",9,\n,,,\n \n"
	if d := preview(t, r, blank); len(d.Errors) != 0 || len(d.Rows) != 1 {
		t.Errorf("blank rows: %+v", d)
	}
	wantStatus(t, call(t, r, "POST", "/api/import", "text/csv", blank, nil), 200)
	// a space before a quoted field is fine (TrimLeadingSpace)
	wantStatus(t, call(t, r, "POST", "/api/import", "text/csv", "date,account,amount\n2026-10-03, \"A\", 8\n", nil), 200)
}

// Write limits from round 3: batch sizes, body size, sort bounds, unique account names, ASCII-only currencies.
func TestWriteLimits(t *testing.T) {
	r, _ := newTestRouter(t)
	var a Account
	wantStatus(t, callJSON(t, r, "POST", "/api/accounts", `{"name":"Cash","kind":"bank"}`, &a), 201)
	id := jsonID(a.ID)
	rows := make([]map[string]any, maxBatchRows+1)
	for i := range rows {
		rows[i] = map[string]any{"account_id": a.ID, "date": "2026-01-01", "amount": i, "fx": 1}
	}
	big, _ := json.Marshal(rows)
	for _, c := range []struct {
		name, method, path, body string
		want                     int
	}{
		{"snapshot batch too big", "POST", "/api/snapshots", string(big), 400},
		{"body over 1 MB", "POST", "/api/events", `{"date":"2026-01-01","title":"` + strings.Repeat("x", maxBody) + `"}`, 400},
		{"duplicate name", "POST", "/api/accounts", `{"name":"cash","kind":"bank"}`, 409},
		{"rename onto another", "POST", "/api/accounts", `{"name":"Wallet","kind":"bank"}`, 201},
		{"rename onto taken name", "PATCH", "/api/accounts/" + id, `{"name":"WALLET"}`, 409},
		{"rename to own name, other case", "PATCH", "/api/accounts/" + id, `{"name":"CASH"}`, 204},
		{"patch kind gone", "PATCH", "/api/accounts/" + id, `{"kind":"nope"}`, 400},
		{"sort too big", "PATCH", "/api/accounts/" + id, `{"sort":9223372036854775807}`, 400},
		{"sort out of range", "PATCH", "/api/accounts/" + id, `{"sort":1000001}`, 400},
		{"kind sort out of range", "POST", "/api/kinds", `{"key":"kk","name":"K","color":"#000000","liquidity":"fixed","sort":2000000}`, 400},
		{"dotless i currency", "POST", "/api/accounts", `{"name":"X","kind":"bank","currency":"ıd"}`, 400},
		{"loan year 0001 says range", "POST", "/api/loans", `{"name":"L","principal":100,"rate":0.02,"start":"0001-01-01","grace_months":0,"total_months":12}`, 400},
		{"new account after sort edits", "POST", "/api/accounts", `{"name":"Y","kind":"bank"}`, 201},
	} {
		if w := callJSON(t, r, c.method, c.path, c.body, nil); w.Code != c.want {
			t.Errorf("%s: status %d want %d (%s)", c.name, w.Code, c.want, w.Body.String())
		}
	}
	var e struct{ Error string }
	callJSON(t, r, "POST", "/api/loans", `{"name":"L","principal":100,"rate":0.02,"start":"0001-01-01","grace_months":0,"total_months":12}`, &e)
	if e.Error != "日期要在 1900–2199 年之間" {
		t.Errorf("loan date message %q", e.Error)
	}
}

func TestHeadAndSPA(t *testing.T) {
	r, _ := newTestRouter(t)
	for _, c := range []struct {
		method, path string
		want         int
	}{
		{"HEAD", "/healthz", 200},
		{"HEAD", "/", 200},
		{"GET", "/", 200},
		{"GET", "/some/client/route", 200},
		{"GET", "/api/nope", 404},
		{"POST", "/nope", 404},
	} {
		w := call(t, r, c.method, c.path, "", "", nil)
		if w.Code != c.want {
			t.Errorf("%s %s: %d want %d", c.method, c.path, w.Code, c.want)
		}
		if c.want == 200 && c.path != "/healthz" && w.Header().Get("Cache-Control") != "no-cache" {
			t.Errorf("%s %s: index.html must not be cached: %v", c.method, c.path, w.Header())
		}
	}
}

// Names match the way they are unique: ignoring case and surrounding space ("schwab" is the account "Schwab").
func TestImportMatchesNamesIgnoringCase(t *testing.T) {
	r, db := newTestRouter(t)
	wantStatus(t, callJSON(t, r, "POST", "/api/accounts", `{"name":"Schwab","kind":"us_stock","currency":"USD"}`, nil), 201)
	csv := "date,account,amount,fx\n2026-01-01,schwab,100,30\n2026-02-01,SCHWAB ,110,31\n"
	d := preview(t, r, csv)
	if len(d.Unknown) != 0 || len(d.Errors) != 0 || d.Rows[0].Currency != "USD" {
		t.Fatalf("dry run: %+v", d)
	}
	wantStatus(t, call(t, r, "POST", "/api/import", "text/csv", csv, nil), 200)
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM snapshots s JOIN accounts a ON a.id=s.account_id WHERE a.name='Schwab'`).Scan(&n)
	if n != 2 {
		t.Fatalf("%d rows on Schwab", n)
	}
	// two spellings of one new name are one account to create, and one date twice is still a duplicate
	d = preview(t, r, "date,account,amount\n2026-01-01,Wise,1\n2026-01-01,wise,2\n")
	if len(d.Unknown) != 1 || !strings.Contains(errorsOf(d), "重複") {
		t.Fatalf("new name in two cases: %+v", d)
	}
}

// Accounts the import creates come last, after every check and rate lookup: a failure leaves nothing behind.
func TestImportCreatesAccountsOnlyWhenEverythingPasses(t *testing.T) {
	r, db := newTestRouter(t)
	accounts := func() (n int) { db.QueryRow(`SELECT COUNT(*) FROM accounts`).Scan(&n); return }
	csv := "date,account,amount\n2026-01-01,Wise,10\n"
	usd := `[{"name":"wise","kind":"bank","currency":"USD"}]`

	old := FXClient
	defer func() { FXClient = old }()
	FXClient = &http.Client{Transport: statusRT(503)}
	if d := previewWith(t, r, csv, usd); len(d.Errors) != 0 {
		t.Fatalf("dry run fetches nothing, so it can't know: %+v", d)
	}
	wantStatus(t, call(t, r, "POST", "/api/import?accounts="+url.QueryEscape(usd), "text/csv", csv, nil), 502)
	if accounts() != 0 {
		t.Fatal("an FX outage left an empty account behind")
	}

	// the picked currency is checked like an existing account's: base currency with a stray fx, dates before the FX source
	if d := previewWith(t, r, "date,account,amount,fx\n2026-01-01,Wise,10,30\n", `[{"name":"Wise","kind":"bank","currency":"TWD"}]`); !strings.Contains(errorsOf(d), "基準幣別") {
		t.Errorf("picked base currency with fx 30: %+v", d)
	}
	if d := previewWith(t, r, "date,account,amount\n2023-12-31,Wise,10\n", usd); !strings.Contains(errorsOf(d), "2023-12-31") {
		t.Errorf("date before the FX source: %+v", d)
	}
	if d := previewWith(t, r, csv, `[{"name":"Wise","kind":"nope","currency":"USD"}]`); !strings.Contains(errorsOf(d), "類別或幣別不正確") {
		t.Errorf("unknown class: %+v", d)
	}
	wantStatus(t, call(t, r, "POST", "/api/import?accounts=nope", "text/csv", csv, nil), 400)

	FXClient = &http.Client{Transport: fxRT(`{"usd":{"twd":31.5}}`)}
	var out struct{ Imported, Created int }
	wantStatus(t, call(t, r, "POST", "/api/import?accounts="+url.QueryEscape(usd), "text/csv", csv, &out), 200)
	var a newAccount
	db.QueryRow(`SELECT name, kind, currency FROM accounts`).Scan(&a.Name, &a.Kind, &a.Currency)
	if out.Created != 1 || a != (newAccount{"Wise", "bank", "USD"}) {
		t.Fatalf("created %d: %+v", out.Created, a)
	}
}

// GET /api/fx through the router (fx_test.go has no build tag; the router tests need SQLite).
func TestFXHandler(t *testing.T) {
	old := FXClient
	defer func() { FXClient = old }()
	r, _ := newTestRouter(t)
	FXClient = &http.Client{Transport: byHost{"cdn.jsdelivr.net": `{"usd":{"twd":32.5}}`}}
	var out struct{ Rate float64 }
	wantStatus(t, callJSON(t, r, "GET", "/api/fx?cur=USD&date=2024-05-01", "", &out), 200)
	if out.Rate != 32.5 {
		t.Errorf("rate %v", out.Rate)
	}
	FXClient = &http.Client{Transport: statusRT(503)}
	var e struct{ Error string }
	wantStatus(t, callJSON(t, r, "GET", "/api/fx?cur=USD&date=2024-05-01", "", &e), 502)
	if !strings.Contains(e.Error, "USD") {
		t.Errorf("error %q", e.Error)
	}
}
