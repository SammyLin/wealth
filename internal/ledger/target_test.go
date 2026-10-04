package ledger

import (
	"math"
	"testing"
	"time"
)

func day(s string) time.Time { d, _ := time.Parse("2006-01-02", s); return d }

func near(t *testing.T, name string, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 1e-6 {
		t.Errorf("%s: %v want %v", name, got, want)
	}
}

// A liability linked to a loan follows the schedule between records: recorded on the disbursement date, it is
// lower on a later date where only an asset was recorded. An unlinked liability still carries forward flat, and
// a fresh record on the linked account wins over the schedule.
func TestSeriesFollowsLoanSchedule(t *testing.T) {
	kindOf := map[int64]string{1: "bank", 2: "liability", 3: "liability"}
	acct := int64(2)
	loan := Loan{ID: 1, AccountID: &acct, Name: "房貸", Principal: 1_000_000, Rate: 0.024, Start: "2026-01-15", TotalMonths: 120}
	snaps := []Snapshot{
		{1, "2026-01-15", 100, 1},
		{2, "2026-01-15", 1_000_000, 1}, // linked to the loan
		{3, "2026-01-15", 500, 1},       // no loan: flat
		{1, "2026-07-15", 100, 1},       // only the bank recorded again
	}
	linked := func(r Row) float64 { return -(r.ByKind["liability"] + 500) }

	rows := seriesWithLoans(snaps, kindOf, testKinds, []Loan{loan})
	if len(rows) != 2 {
		t.Fatalf("got %d rows", len(rows))
	}
	near(t, "first row", rows[0].Total, 100-1_000_000-500)
	owedJuly := loan.Balance(day("2026-07-15"))
	if owedJuly >= 1_000_000 || owedJuly < 940_000 {
		t.Fatalf("schedule sanity: %v", owedJuly)
	}
	near(t, "projected owed", linked(rows[1]), owedJuly)

	plain := series(snaps, kindOf, testKinds)
	near(t, "plain series carries flat", linked(plain[1]), 1_000_000)

	snaps = append(snaps, Snapshot{2, "2026-07-15", 900_000, 1}, Snapshot{1, "2026-08-15", 100, 1})
	rows = seriesWithLoans(snaps, kindOf, testKinds, []Loan{loan})
	near(t, "fresh record wins", linked(rows[1]), 900_000)
	near(t, "moves on from the record", linked(rows[2]), 900_000-(owedJuly-loan.Balance(day("2026-08-15"))))
}

func TestSettingsTarget(t *testing.T) {
	r, _ := newTestRouter(t)
	var st struct{ Settings map[string]string }
	callJSON(t, r, "GET", "/api/state", "", &st)
	if st.Settings["target_amount"] != "" || st.Settings["target_date"] != "" {
		t.Fatalf("defaults: %v", st.Settings)
	}
	wantStatus(t, callJSON(t, r, "PUT", "/api/settings", `{"target_amount":"100000000","target_date":"2031-03-01"}`, nil), 204)
	callJSON(t, r, "GET", "/api/state", "", &st)
	if st.Settings["target_amount"] != "100000000" || st.Settings["target_date"] != "2031-03-01" {
		t.Fatalf("saved: %v", st.Settings)
	}
	wantStatus(t, callJSON(t, r, "PUT", "/api/settings", `{"target_amount":"","target_date":""}`, nil), 204) // cleared
	for name, body := range map[string]string{
		"negative": `{"target_amount":"-1"}`,
		"zero":     `{"target_amount":"0"}`,
		"text":     `{"target_amount":"一億"}`,
		"huge":     `{"target_amount":"1e16"}`,
		"bad date": `{"target_date":"2031-13-01"}`,
		"far date": `{"target_date":"2300-01-01"}`,
	} {
		if w := callJSON(t, r, "PUT", "/api/settings", body, nil); w.Code != 400 {
			t.Errorf("%s: status %d", name, w.Code)
		}
	}
}
