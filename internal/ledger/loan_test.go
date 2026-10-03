package ledger

import (
	"encoding/json"
	"math"
	"os"
	"testing"
	"time"
)

// Figures from a real bank schedule (4 tranches, 36-month grace, 30 years).
func TestLoanMatchesSheet(t *testing.T) {
	loans := []Loan{
		{ID: 1, Principal: 1260000, Rate: 0.025, Start: "2025-04-14", GraceMonths: 36, TotalMonths: 360},
		{ID: 2, Principal: 5680000, Rate: 0.0245, Start: "2023-09-19", GraceMonths: 36, TotalMonths: 360},
		{ID: 3, Principal: 320000, Rate: 0.025, Start: "2023-09-19", GraceMonths: 36, TotalMonths: 360},
		{ID: 4, Principal: 750000, Rate: 0.025, Start: "2023-09-19", GraceMonths: 36, TotalMonths: 360},
	}
	month := func(s string) time.Time { m, _ := time.Parse("2006-01", s); return m }
	total := func(m string) float64 {
		var t float64
		for _, l := range loans {
			t += math.Round(l.Payment(month(m)))
		}
		return t
	}
	for m, want := range map[string]float64{"2023-10": 13827, "2025-04": 13827, "2025-05": 16452, "2026-09": 16452, "2026-10": 31151, "2028-04": 31151, "2028-05": 33878} {
		if got := total(m); got != want {
			t.Errorf("%s total %v want %v", m, got, want)
		}
	}
	if got := math.Round(loans[1].levelPayment()); got != 23981 {
		t.Errorf("loan2 level payment %v want 23981", got)
	}
	if got := loans[1].GraceEnd(); got != "2026-09-19" {
		t.Errorf("grace end %s", got)
	}
	if b := loans[1].Balance(month("2026-09")); b != 5680000 {
		t.Errorf("balance during grace %v", b)
	}
	if b := loans[1].Balance(month("2053-09")); b != 0 {
		t.Errorf("balance after payoff %v", b)
	}
	if b := loans[1].Balance(month("2026-10")); b >= 5680000 || b < 5660000 {
		t.Errorf("first amortizing payment should cut principal a little: %v", b)
	}
}

// testdata/loans.json is shared with web/src/features/loans/math.check.ts (the LoanModal preview's math).
func TestLoanVectors(t *testing.T) {
	var v struct {
		AddMonths  [][3]any `json:"add_months"`
		Validation []struct {
			Loan  Loan   `json:"loan"`
			Error string `json:"error"`
		} `json:"validation"`
		Cases []struct {
			Principal   float64 `json:"principal"`
			Rate        float64 `json:"rate"`
			GraceMonths int     `json:"grace_months"`
			TotalMonths int     `json:"total_months"`
			Level       float64 `json:"level"`
		}
	}
	readJSON(t, "testdata/loans.json", &v)
	for _, c := range v.Cases {
		l := Loan{Principal: c.Principal, Rate: c.Rate, GraceMonths: c.GraceMonths, TotalMonths: c.TotalMonths}
		if got := l.levelPayment(); math.Abs(got-c.Level) > 1e-6 {
			t.Errorf("%+v: level %v want %v", c, got, c.Level)
		}
	}
	for _, c := range v.AddMonths {
		from, _ := time.Parse("2006-01-02", c[0].(string))
		if got := addMonths(from, int(c[1].(float64))).Format("2006-01-02"); got != c[2] {
			t.Errorf("%v + %v months = %s, want %v", c[0], c[1], got, c[2])
		}
	}
	for _, c := range v.Validation {
		if got := validLoan(c.Loan); got != c.Error {
			t.Errorf("%+v: %q, want %q", c.Loan, got, c.Error)
		}
	}
	if len(v.AddMonths) == 0 || len(v.Validation) == 0 {
		t.Fatal("testdata/loans.json lost its add_months / validation cases")
	}
}

// A month-end drawdown: grace end and payoff clamp to the month's last day, and the schedule has no
// trailing zero month (time.AddDate's overflow put 2021-03-03 as the payoff of a 13-month loan).
func TestLoanMonthEnd(t *testing.T) {
	l := Loan{ID: 1, Name: "x", Principal: 1300, Rate: 0, Start: "2020-01-31", GraceMonths: 1, TotalMonths: 13}
	views, sched := loanViews([]Loan{l}, time.Date(2020, 6, 1, 0, 0, 0, 0, time.UTC))
	if v := views[0]; v.GraceEnd != "2020-02-29" || v.EndDate != "2021-02-28" {
		t.Errorf("grace end %s, end %s", v.GraceEnd, v.EndDate)
	}
	if len(sched) != 13 || sched[len(sched)-1].Month != "2021-02" || sched[len(sched)-1].Total == 0 {
		t.Errorf("schedule %d months, last %+v", len(sched), sched[len(sched)-1])
	}
}

func readJSON(t *testing.T, path string, v any) {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, v); err != nil {
		t.Fatal(err)
	}
}
