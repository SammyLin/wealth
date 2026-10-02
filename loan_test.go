package main

import (
	"math"
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
