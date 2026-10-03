//go:build !js

package ledger

import (
	"context"
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	_ "modernc.org/sqlite"
)

func newTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	if err := Migrate(db); err != nil {
		t.Fatal(err)
	}
	return db
}

// call sends one request through the real router and decodes a JSON response into out (if non-nil).
func call(t *testing.T, r *gin.Engine, method, path, ctype, body string, out any) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", ctype)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if out != nil && w.Body.Len() > 0 {
		if err := json.Unmarshal(w.Body.Bytes(), out); err != nil {
			t.Fatalf("%s %s: bad json %q: %v", method, path, w.Body.String(), err)
		}
	}
	return w
}

func callJSON(t *testing.T, r *gin.Engine, method, path, body string, out any) *httptest.ResponseRecorder {
	return call(t, r, method, path, "application/json", body, out)
}

func wantStatus(t *testing.T, w *httptest.ResponseRecorder, want int) {
	t.Helper()
	if w.Code != want {
		t.Fatalf("status %d want %d, body %s", w.Code, want, w.Body.String())
	}
}

func newTestRouter(t *testing.T) (*gin.Engine, *sql.DB) {
	gin.SetMode(gin.TestMode)
	db := newTestDB(t)
	return New(db, false), db
}

func TestMigrationSeedsKindsAndColumns(t *testing.T) {
	db := newTestDB(t)
	kinds, err := listKinds(context.Background(), db)
	if err != nil {
		t.Fatal(err)
	}
	if len(kinds) != 7 || kinds[0].Key != "bank" || kinds[6].Key != "liability" || kinds[6].Liquidity != "liability" {
		t.Fatalf("seed kinds: %+v", kinds)
	}
	if _, err := db.Exec(`INSERT INTO accounts (name, kind, currency, sort, note) VALUES ('a', 'bank', 'TWD', 3, 'n')`); err != nil {
		t.Fatalf("0002 columns missing: %v", err)
	}
}

func TestKindsCRUD(t *testing.T) {
	r, _ := newTestRouter(t)
	var k Kind
	wantStatus(t, callJSON(t, r, "POST", "/api/kinds", `{"key":"card","name":"信用卡","color":"#AABBCC","liquidity":"liability","sort":9}`, &k), 201)
	if k.Key != "card" || k.Color != "#aabbcc" {
		t.Fatalf("created %+v", k)
	}
	wantStatus(t, callJSON(t, r, "POST", "/api/kinds", `{"key":"card","name":"x","color":"#000000","liquidity":"fixed"}`, nil), 409)
	for name, body := range map[string]string{
		"bad key":       `{"key":"Card","name":"x","color":"#000000","liquidity":"fixed"}`,
		"bad color":     `{"key":"abc","name":"x","color":"red","liquidity":"fixed"}`,
		"bad liquidity": `{"key":"abc","name":"x","color":"#000000","liquidity":"cash"}`,
		"empty name":    `{"key":"abc","name":" ","color":"#000000","liquidity":"fixed"}`,
	} {
		if w := callJSON(t, r, "POST", "/api/kinds", body, nil); w.Code != 400 {
			t.Errorf("%s: status %d", name, w.Code)
		}
	}

	wantStatus(t, callJSON(t, r, "PUT", "/api/kinds/card", `{"key":"hacked","name":"卡費","color":"#112233","liquidity":"liability","sort":1}`, &k), 200)
	if k.Key != "card" || k.Name != "卡費" {
		t.Fatalf("key must be immutable: %+v", k)
	}
	wantStatus(t, callJSON(t, r, "PUT", "/api/kinds/nope", `{"name":"x","color":"#000000","liquidity":"fixed"}`, nil), 404)

	// in use: 409 with a Chinese message, and the kind survives
	var acct Account
	wantStatus(t, callJSON(t, r, "POST", "/api/accounts", `{"name":"VISA","kind":"card"}`, &acct), 201)
	var e struct{ Error string }
	wantStatus(t, callJSON(t, r, "DELETE", "/api/kinds/card", "", &e), 409)
	if e.Error == "" {
		t.Error("409 without message")
	}
	var st struct{ Kinds []Kind }
	callJSON(t, r, "GET", "/api/state", "", &st)
	if len(st.Kinds) != 8 || st.Kinds[1].Key != "card" { // sort 1 ties with tw_stock; key breaks the tie
		t.Fatalf("state kinds: %+v", st.Kinds)
	}

	wantStatus(t, callJSON(t, r, "DELETE", "/api/accounts/"+jsonID(acct.ID), "", nil), 204)
	wantStatus(t, callJSON(t, r, "DELETE", "/api/kinds/card", "", nil), 204)
	callJSON(t, r, "GET", "/api/state", "", &st)
	if len(st.Kinds) != 7 {
		t.Fatalf("kind not deleted: %+v", st.Kinds)
	}
}

func jsonID(id int64) string { b, _ := json.Marshal(id); return string(b) }

func TestAccountKindSortNote(t *testing.T) {
	r, _ := newTestRouter(t)
	wantStatus(t, callJSON(t, r, "POST", "/api/accounts", `{"name":"x","kind":"nope"}`, nil), 400)
	var a, b, c Account
	wantStatus(t, callJSON(t, r, "POST", "/api/accounts", `{"name":"A","kind":"bank","note":" 薪轉 "}`, &a), 201)
	wantStatus(t, callJSON(t, r, "POST", "/api/accounts", `{"name":"B","kind":"bank"}`, &b), 201)
	wantStatus(t, callJSON(t, r, "POST", "/api/accounts", `{"name":"C","kind":"bank"}`, &c), 201)
	if a.Note != "薪轉" || a.Sort != 0 || b.Sort != 1 || c.Sort != 2 {
		t.Fatalf("new accounts: %+v %+v %+v", a, b, c)
	}

	wantStatus(t, callJSON(t, r, "PUT", "/api/accounts/order", `{"ids":[`+jsonID(c.ID)+`,`+jsonID(a.ID)+`,`+jsonID(b.ID)+`]}`, nil), 204)
	wantStatus(t, callJSON(t, r, "PUT", "/api/accounts/order", `{"ids":[1,1]}`, nil), 400)
	wantStatus(t, callJSON(t, r, "PATCH", "/api/accounts/"+jsonID(a.ID), `{"kind":"crypto","note":"改過","sort":7}`, nil), 204)
	wantStatus(t, callJSON(t, r, "PATCH", "/api/accounts/"+jsonID(a.ID), `{"kind":"nope"}`, nil), 400)

	var st struct{ Accounts []Account }
	callJSON(t, r, "GET", "/api/state", "", &st)
	got := []string{}
	for _, x := range st.Accounts {
		got = append(got, x.Name)
	}
	// c=0, b=2, a=7
	if strings.Join(got, "") != "CBA" || st.Accounts[2].Kind != "crypto" || st.Accounts[2].Note != "改過" || st.Accounts[2].Sort != 7 {
		t.Fatalf("state accounts: %+v", st.Accounts)
	}
}

// 100 accounts take three statements; every id must land on its own index.
func TestAccountOrderChunks(t *testing.T) {
	r, db := newTestRouter(t)
	ids := make([]int64, 0, 100)
	for i := 0; i < 100; i++ {
		res, err := db.Exec(`INSERT INTO accounts (name, kind, currency) VALUES (?, 'bank', 'TWD')`, i)
		if err != nil {
			t.Fatal(err)
		}
		id, _ := res.LastInsertId()
		ids = append([]int64{id}, ids...) // reversed
	}
	body, _ := json.Marshal(map[string]any{"ids": ids})
	wantStatus(t, callJSON(t, r, "PUT", "/api/accounts/order", string(body), nil), 204)
	for i, id := range ids {
		var sort int
		db.QueryRow(`SELECT sort FROM accounts WHERE id=?`, id).Scan(&sort)
		if sort != i {
			t.Fatalf("id %d sort %d want %d", id, sort, i)
		}
	}
}

func TestSettingsUnitAndLayout(t *testing.T) {
	r, _ := newTestRouter(t)
	var st struct{ Settings map[string]string }
	callJSON(t, r, "GET", "/api/state", "", &st)
	if st.Settings["unit"] != "wan" || !json.Valid([]byte(st.Settings["layout"])) {
		t.Fatalf("defaults: %v", st.Settings)
	}
	layout := `{"sections":[{"id":"sheet","hidden":false}]}`
	body, _ := json.Marshal(map[string]string{"unit": "k", "layout": layout})
	wantStatus(t, callJSON(t, r, "PUT", "/api/settings", string(body), nil), 204)
	callJSON(t, r, "GET", "/api/state", "", &st)
	if st.Settings["unit"] != "k" || st.Settings["layout"] != layout {
		t.Fatalf("saved: %v", st.Settings)
	}
	huge, _ := json.Marshal(map[string]string{"layout": `"` + strings.Repeat("x", maxLayoutBytes) + `"`})
	for name, body := range map[string]string{
		"bad unit":    `{"unit":"yi"}`,
		"bad json":    `{"layout":"{nope"}`,
		"empty":       `{"layout":""}`,
		"layout size": string(huge),
	} {
		if w := callJSON(t, r, "PUT", "/api/settings", body, nil); w.Code != 400 {
			t.Errorf("%s: status %d", name, w.Code)
		}
	}
}

func TestImportThenExport(t *testing.T) {
	r, _ := newTestRouter(t)
	wantStatus(t, callJSON(t, r, "POST", "/api/accounts", `{"name":"薪轉戶","kind":"bank"}`, nil), 201)
	wantStatus(t, callJSON(t, r, "POST", "/api/accounts", `{"name":"房貸","kind":"liability"}`, nil), 201)
	wantStatus(t, callJSON(t, r, "POST", "/api/accounts", `{"name":"Wise","kind":"bank","currency":"USD"}`, nil), 201)

	oldClient := FXClient
	defer func() { FXClient = oldClient }()
	FXClient = &http.Client{Transport: fxRT(`{"usd":{"twd":30}}`)}

	// BOM + quoted thousands separators like Excel writes them; USD row has no fx so it is looked up
	csvIn := "\xef\xbb\xbfdate,account,amount,fx\n" +
		"2026-01-01,薪轉戶,\"1,000\",\n" +
		"2026-01-01,房貸,400,1\n" +
		"2026-01-01,Wise,10,\n" +
		"2026-02-01,薪轉戶,1500,\n"
	var out struct{ Imported int }
	wantStatus(t, call(t, r, "POST", "/api/import", "text/csv", csvIn, &out), 200)
	if out.Imported != 4 {
		t.Fatalf("imported %d", out.Imported)
	}
	// importing again is an upsert, not a duplicate
	wantStatus(t, call(t, r, "POST", "/api/import", "text/csv", csvIn, &out), 200)

	var st struct {
		Accounts []Account
		Series   []Row
	}
	callJSON(t, r, "GET", "/api/state", "", &st)
	if st.Accounts[2].FX != 30 || st.Accounts[2].Amount != 10 {
		t.Fatalf("fx lookup: %+v", st.Accounts[2])
	}
	if len(st.Series) != 2 || st.Series[0].Total != 1000-400+300 || st.Series[1].Total != 1500-400+300 {
		t.Fatalf("series: %+v", st.Series)
	}

	// export is the wide layout; every imported figure must show up under its account and date
	w := callJSON(t, r, "GET", "/api/export.csv", "", nil)
	wantStatus(t, w, 200)
	recs, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(w.Body.String(), "\xef\xbb\xbf"))).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	byName := map[string][]string{}
	for _, rec := range recs {
		byName[rec[0]] = rec
	}
	if h := recs[0]; len(h) != 6 || h[4] != "2026-01-01" || h[5] != "2026-02-01" {
		t.Fatalf("header %v", h)
	}
	for name, want := range map[string][]string{"薪轉戶": {"銀行", "TWD", "", "1000", "1500"}, "房貸": {"負債", "TWD", "", "400", ""}, "Wise": {"銀行", "USD", "", "10", ""}} {
		if got := byName[name][1:]; strings.Join(got, "|") != strings.Join(want, "|") {
			t.Errorf("%s: %v want %v", name, got, want)
		}
	}
	if got := byName["淨資產(TWD)"]; got[4] != "900" || got[5] != "1400" {
		t.Errorf("net worth row %v", got)
	}
	if byName["小計 負債(TWD)"][4] != "-400" {
		t.Errorf("liability subtotal %v", byName["小計 負債(TWD)"])
	}
	if got := byName["匯率 USD(對 TWD)"]; len(got) < 5 || got[4] != "30" {
		t.Errorf("fx row %v", got)
	}

	// the long export is the import layout: re-importing it into a fresh ledger reproduces the series
	long := callJSON(t, r, "GET", "/api/export.csv?layout=long", "", nil).Body.String()
	r2, _ := newTestRouter(t)
	for _, a := range []string{`{"name":"薪轉戶","kind":"bank"}`, `{"name":"房貸","kind":"liability"}`, `{"name":"Wise","kind":"bank","currency":"USD"}`} {
		wantStatus(t, callJSON(t, r2, "POST", "/api/accounts", a, nil), 201)
	}
	wantStatus(t, call(t, r2, "POST", "/api/import", "text/csv", long, &out), 200)
	var st2 struct{ Series []Row }
	callJSON(t, r2, "GET", "/api/state", "", &st2)
	if len(st2.Series) != 2 || st2.Series[0].Total != st.Series[0].Total || st2.Series[1].Total != st.Series[1].Total {
		t.Fatalf("long export didn't round-trip: %+v vs %+v", st2.Series, st.Series)
	}
}

func TestImportRejectsBadInput(t *testing.T) {
	r, db := newTestRouter(t)
	wantStatus(t, callJSON(t, r, "POST", "/api/accounts", `{"name":"A","kind":"bank"}`, nil), 201)
	for name, c := range map[string]struct{ body, want string }{
		"unknown accounts": {"date,account,amount\n2026-01-01,A,1\n2026-01-01,Z,2\n2026-01-01,Y,3\n", "Y、Z"},
		"bad date":         {"date,account,amount\n01/02/2026,A,1\n", "第 2 列"},
		"bad amount":       {"date,account,amount\n2026-01-01,A,abc\n", "第 2 列"},
		"bad fx":           {"date,account,amount,fx\n2026-01-01,A,1,-3\n", "第 2 列"},
		"no header":        {"2026-01-01,A,1\n", "標題"},
		"infinite amount":  {"date,account,amount\n2026-01-01,A,Inf\n", "第 2 列"},
		"NaN amount":       {"date,account,amount\n2026-01-01,A,NaN\n", "第 2 列"},
		"huge amount":      {"date,account,amount\n2026-01-01,A,1e300\n", "第 2 列"},
		"euro decimal":     {"date,account,amount\n2026-01-01,A,\"1.234,56\"\n", "第 2 列"},
		"semicolons":       {"date;account;amount\n2026-01-01;A;1\n", "分號"},
		"not utf-8":        {"date,account,amount\n2026-01-01,\xb0\xea,1\n", "UTF-8"},
		"empty":            {"", "空的"},
		"future date":      {"date,account,amount\n2026-01-01,A,1\n2062-09-30,A,100\n", "第 3 列的日期在未來"},
		"fx on base":       {"date,account,amount,fx\n2026-01-01,A,1,5\n", "基準幣別"},
	} {
		var e struct{ Error string }
		w := call(t, r, "POST", "/api/import", "text/csv", c.body, &e)
		if w.Code != 400 || !strings.Contains(e.Error, c.want) {
			t.Errorf("%s: status %d, error %q", name, w.Code, e.Error)
		}
	}
	// the first rows were fine but the file as a whole was not: nothing may be written
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM snapshots`).Scan(&n)
	if n != 0 {
		t.Fatalf("%d rows written by rejected imports", n)
	}
}

type fxRT string

func (f fxRT) RoundTrip(*http.Request) (*http.Response, error) {
	return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(f)))}, nil
}

func TestParseAmount(t *testing.T) {
	for in, want := range map[string]float64{"1,234,567": 1234567, "12.5萬": 125000, "3k": 3000, "−500": -500, "１２３": 123, "NT$1,000": 1000, "1.5億": 1.5e8, "0.1": 0.1} {
		if got := parseAmount(in); got != want {
			t.Errorf("%q: %v want %v", in, got, want)
		}
	}
	for _, in := range []string{"", "abc", "1.234,56", "12,34", "Inf", "NaN", "1e5"} {
		if got := parseAmount(in); !math.IsNaN(got) {
			t.Errorf("%q: %v want NaN", in, got)
		}
	}
}

// Every write route rejects values that would break /api/state or point at nothing.
func TestWriteValidation(t *testing.T) {
	r, _ := newTestRouter(t)
	var a Account
	wantStatus(t, callJSON(t, r, "POST", "/api/accounts", `{"name":"A","kind":"bank"}`, &a), 201)
	id := jsonID(a.ID)
	for _, c := range []struct {
		name, method, path, body string
		want                     int
	}{
		{"snapshot huge amount", "POST", "/api/snapshots", `[{"account_id":` + id + `,"date":"2026-01-01","amount":1e308,"fx":1}]`, 400},
		{"snapshot huge fx", "POST", "/api/snapshots", `[{"account_id":` + id + `,"date":"2026-01-01","amount":1,"fx":1e308}]`, 400},
		{"snapshot zero fx", "POST", "/api/snapshots", `[{"account_id":` + id + `,"date":"2026-01-01","amount":1,"fx":0}]`, 400},
		{"snapshot bad date", "POST", "/api/snapshots", `[{"account_id":` + id + `,"date":"2026-13-01","amount":1,"fx":1}]`, 400},
		{"snapshot unknown account", "POST", "/api/snapshots", `[{"account_id":999,"date":"2026-01-01","amount":1,"fx":1}]`, 400},
		{"snapshot future date", "POST", "/api/snapshots", `[{"account_id":` + id + `,"date":"2099-01-01","amount":1,"fx":1}]`, 400},
		{"snapshot year 0001", "POST", "/api/snapshots", `[{"account_id":` + id + `,"date":"0001-01-01","amount":1,"fx":1}]`, 400},
		{"snapshot fx on base currency", "POST", "/api/snapshots", `[{"account_id":` + id + `,"date":"2026-01-01","amount":100,"fx":5}]`, 400},
		{"loan huge principal", "POST", "/api/loans", `{"name":"L","principal":1.7e308,"rate":0.2,"start":"2026-09-01","grace_months":0,"total_months":1}`, 400},
		{"loan long name", "POST", "/api/loans", `{"name":"` + strings.Repeat("x", 61) + `","principal":100,"rate":0.02,"start":"2026-01-01","grace_months":0,"total_months":12}`, 400},
		{"loan year 0001", "POST", "/api/loans", `{"name":"L","principal":100,"rate":0.02,"start":"0001-01-01","grace_months":0,"total_months":12}`, 400},
		{"loan year 9999", "POST", "/api/loans", `{"name":"L","principal":100,"rate":0.02,"start":"9999-01-01","grace_months":0,"total_months":12}`, 400},
		{"loan negative rate", "POST", "/api/loans", `{"name":"L","principal":100,"rate":-0.01,"start":"2026-01-01","grace_months":0,"total_months":12}`, 400},
		{"loan grace >= total", "POST", "/api/loans", `{"name":"L","principal":100,"rate":0.02,"start":"2026-01-01","grace_months":12,"total_months":12}`, 400},
		{"loan too long", "POST", "/api/loans", `{"name":"L","principal":100,"rate":0.02,"start":"2026-01-01","grace_months":0,"total_months":601}`, 400},
		{"patch bad currency", "PATCH", "/api/accounts/" + id, `{"currency":"us"}`, 400},
		{"settings not json", "PUT", "/api/settings", `[1]`, 400},
		{"snapshot ok", "POST", "/api/snapshots", `[{"account_id":` + id + `,"date":"2026-01-01","amount":1,"fx":1}]`, 204},
		{"long account name", "POST", "/api/accounts", `{"name":"` + strings.Repeat("x", 61) + `","kind":"bank"}`, 400},
		{"patch missing account", "PATCH", "/api/accounts/999", `{"note":"x"}`, 404},
		{"patch long name", "PATCH", "/api/accounts/" + id, `{"name":"` + strings.Repeat("x", 61) + `"}`, 400},
		{"delete missing account", "DELETE", "/api/accounts/999", "", 404},
		{"blank title", "PUT", "/api/settings", `{"title":"  "}`, 400},
		{"loan unknown account", "POST", "/api/loans", `{"account_id":999,"name":"L","principal":100,"rate":0.02,"start":"2026-01-01","grace_months":0,"total_months":12}`, 400},
		{"loan ok", "POST", "/api/loans", `{"account_id":` + id + `,"name":"L","principal":100,"rate":0.02,"start":"2026-01-01","grace_months":0,"total_months":12}`, 201},
		{"update missing loan", "PUT", "/api/loans/999", `{"name":"L","principal":100,"rate":0.02,"start":"2026-01-01","grace_months":0,"total_months":12}`, 404},
		{"delete missing loan", "DELETE", "/api/loans/999", "", 404},
		{"event ok", "POST", "/api/events", `{"date":"2026-01-01","title":"x"}`, 201},
		{"update missing event", "PUT", "/api/events/999", `{"date":"2026-01-01","title":"x"}`, 404},
		{"delete missing event", "DELETE", "/api/events/999", "", 404},
		{"delete missing snapshot", "DELETE", "/api/snapshots?account_id=" + id + "&date=2020-01-01", "", 404},
		{"duplicate kind name", "POST", "/api/kinds", `{"key":"bank2","name":"銀行","color":"#000000","liquidity":"liquid"}`, 409},
		{"rename kind onto another", "PUT", "/api/kinds/tw_stock", `{"name":"美股","color":"#000000","liquidity":"invest","sort":1}`, 409},
	} {
		if w := callJSON(t, r, c.method, c.path, c.body, nil); w.Code != c.want {
			t.Errorf("%s: status %d want %d (%s)", c.name, w.Code, c.want, w.Body.String())
		}
	}
	var st struct{ Accounts []Account }
	wantStatus(t, callJSON(t, r, "GET", "/api/state", "", &st), 200)
	if len(st.Accounts) != 1 || st.Accounts[0].Amount != 1 {
		t.Fatalf("state after rejected writes: %+v", st.Accounts)
	}

	// a rejected PATCH changes nothing, not even the fields before the bad one
	wantStatus(t, callJSON(t, r, "PATCH", "/api/accounts/"+id, `{"name":"RENAMED","kind":"nope"}`, nil), 400)
	callJSON(t, r, "GET", "/api/state", "", &st)
	if st.Accounts[0].Name != "A" {
		t.Fatalf("partial PATCH applied: %+v", st.Accounts[0])
	}
}

// Server messages with values carry key + params so the UI can translate them.
func TestErrorKeyParams(t *testing.T) {
	r, _ := newTestRouter(t)
	var e struct {
		Error  string
		Key    string
		Params []any
	}
	call(t, r, "POST", "/api/import", "text/csv", "date,account,amount\n2026-01-01,Z,1\n2026-01-01,Y,1\n", &e)
	if e.Error != "找不到這些帳戶:Y、Z" || e.Key != "找不到這些帳戶:{}" || len(e.Params) != 1 {
		t.Fatalf("got %+v", e)
	}
}

func TestKindOrder(t *testing.T) {
	r, _ := newTestRouter(t)
	wantStatus(t, callJSON(t, r, "PUT", "/api/kinds/order", `{"keys":["liability","bank","tw_stock","us_stock","crypto","movable","real_estate"]}`, nil), 204)
	wantStatus(t, callJSON(t, r, "PUT", "/api/kinds/order", `{"keys":["bank","bank"]}`, nil), 400)
	var st struct{ Kinds []Kind }
	callJSON(t, r, "GET", "/api/state", "", &st)
	if st.Kinds[0].Key != "liability" || st.Kinds[1].Key != "bank" {
		t.Fatalf("order: %+v", st.Kinds)
	}
}

// Cross-site writes: a form-encodable body type or a foreign Origin is refused before any handler runs.
func TestGuardWrites(t *testing.T) {
	r, _ := newTestRouter(t)
	if w := call(t, r, "POST", "/api/events", "text/plain", `{"date":"2026-01-01","title":"x"}`, nil); w.Code != 415 {
		t.Errorf("text/plain: %d", w.Code)
	}
	req := httptest.NewRequest("POST", "/api/events", strings.NewReader(`{"date":"2026-01-01","title":"x"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://evil.example")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 403 {
		t.Errorf("foreign origin: %d", w.Code)
	}
	// behind nginx's default proxy_pass the Host is the upstream; X-Forwarded-Host carries the public one
	for _, c := range []struct {
		fwd  string
		want int
	}{{"", 403}, {"wealth.example", 201}, {"evil.example", 403}} {
		req := httptest.NewRequest("POST", "/api/events", strings.NewReader(`{"date":"2026-01-01","title":"x"}`))
		req.Host = "127.0.0.1:8080"
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", "https://wealth.example")
		if c.fwd != "" {
			req.Header.Set("X-Forwarded-Host", c.fwd)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != c.want {
			t.Errorf("proxy, X-Forwarded-Host %q: %d want %d", c.fwd, w.Code, c.want)
		}
	}
	if w := call(t, r, "GET", "/healthz", "", "", nil); w.Code != 200 || w.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Errorf("healthz: %d %v", w.Code, w.Header())
	}
}

// A param that contains {} must not be filled by the next value.
func TestBadSinglePass(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	bad(c, 400, "{} 和 {}", "a{}", "b")
	var e struct{ Error string }
	json.Unmarshal(w.Body.Bytes(), &e)
	if e.Error != "a{} 和 b" {
		t.Fatalf("got %q", e.Error)
	}
}

// Names starting with ' (or a formula character after one) survive export → import.
func TestEscapeCellRoundTrip(t *testing.T) {
	for _, s := range []string{"=x", "'=x", "'plain", "''", "+1", "ok", "'"} {
		if got := unescapeCell(escapeCell(s)); got != s {
			t.Errorf("%q → %q → %q", s, escapeCell(s), got)
		}
	}
}

// A loan row saved before the bounds existed must not break /api/state.
func TestLoanViewsSkipsBadRows(t *testing.T) {
	r, db := newTestRouter(t)
	for _, q := range []string{
		`INSERT INTO loans (name, principal, rate, start, grace_months, total_months) VALUES ('a', 1.7e308, 0.2, '2026-09-01', 0, 1)`,
		`INSERT INTO loans (name, principal, rate, start, grace_months, total_months) VALUES ('b', 1.7e308, 0.2, '2026-09-01', 0, 1)`,
		`INSERT INTO loans (name, principal, rate, start, grace_months, total_months) VALUES ('c', 1000, 0.02, '0001-01-01', 0, 12)`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	var st struct {
		Loans        []LoanView
		LoanSchedule []MonthPay `json:"loan_schedule"`
	}
	wantStatus(t, callJSON(t, r, "GET", "/api/state", "", &st), 200)
	if len(st.Loans) != 3 || len(st.LoanSchedule) != 0 {
		t.Fatalf("loans %d, schedule %d", len(st.Loans), len(st.LoanSchedule))
	}
}
