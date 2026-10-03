package ledger

import (
	"math"
	"time"
)

// Loan is one mortgage tranche: interest-only for GraceMonths, then level payments (本息平均攤還)
// over the remaining TotalMonths-GraceMonths. The first payment falls in the month after Start.
type Loan struct {
	ID          int64   `json:"id"`
	AccountID   *int64  `json:"account_id"`
	Name        string  `json:"name"`
	Principal   float64 `json:"principal"`
	Rate        float64 `json:"rate"` // annual, e.g. 0.0245
	Start       string  `json:"start"`
	GraceMonths int     `json:"grace_months"`
	TotalMonths int     `json:"total_months"`
}

// monthsAfter counts calendar months from a's month to b's month.
func monthsAfter(a, b time.Time) int {
	return (b.Year()-a.Year())*12 + int(b.Month()-a.Month())
}

func (l Loan) start() time.Time { t, _ := time.Parse("2006-01-02", l.Start); return t }

func (l Loan) levelPayment() float64 {
	r, n := l.Rate/12, float64(l.TotalMonths-l.GraceMonths)
	if n <= 0 {
		return 0
	}
	if r == 0 {
		return l.Principal / n
	}
	return l.Principal * r / (1 - math.Pow(1+r, -n))
}

// Payment is what is due in the calendar month containing m.
func (l Loan) Payment(m time.Time) float64 {
	k := monthsAfter(l.start(), m)
	switch {
	case k < 1 || k > l.TotalMonths:
		return 0
	case k <= l.GraceMonths:
		return l.Principal * l.Rate / 12
	default:
		return l.levelPayment()
	}
}

// Balance is the principal still owed after the payment in month m.
func (l Loan) Balance(m time.Time) float64 {
	k := monthsAfter(l.start(), m) - l.GraceMonths // amortizing payments made so far
	if k <= 0 {
		return l.Principal
	}
	n := l.TotalMonths - l.GraceMonths
	if k >= n {
		return 0
	}
	r := l.Rate / 12
	if r == 0 {
		return l.Principal * float64(n-k) / float64(n)
	}
	return l.Principal * (math.Pow(1+r, float64(n)) - math.Pow(1+r, float64(k))) / (math.Pow(1+r, float64(n)) - 1)
}

// addMonths moves t by n calendar months, keeping the day but clamping it to the target month's last day:
// Aug 31 + 6 = Feb 28, not time.AddDate's Mar 3. web/src/features/loans/math.ts addMonths matches it
// (testdata/loans.json "add_months").
func addMonths(t time.Time, n int) time.Time {
	first := time.Date(t.Year(), t.Month()+time.Month(n), 1, 0, 0, 0, 0, time.UTC)
	last := first.AddDate(0, 1, -1).Day()
	return first.AddDate(0, 0, min(t.Day(), last)-1)
}

// GraceEnd is the date the interest-only period ends (start + grace months).
func (l Loan) GraceEnd() string { return addMonths(l.start(), l.GraceMonths).Format("2006-01-02") }

type LoanView struct {
	Loan
	GraceEnd     string  `json:"grace_end"`
	PaymentNow   float64 `json:"payment_now"`
	GracePayment float64 `json:"grace_payment"`
	LevelPayment float64 `json:"level_payment"`
	BalanceNow   float64 `json:"balance_now"`
	EndDate      string  `json:"end_date"`
}

type MonthPay struct {
	Month string            `json:"month"` // YYYY-MM
	Total float64           `json:"total"`
	By    map[int64]float64 `json:"by"`
}

// loanViews summarizes each loan as of now and builds the month-by-month total payment
// from the earliest first payment until every loan is paid off.
func loanViews(loans []Loan, now time.Time) ([]LoanView, []MonthPay) {
	views := []LoanView{}
	sched := []MonthPay{}
	if len(loans) == 0 {
		return views, sched
	}
	// Rows saved before validLoan had bounds are still listed (so they can be deleted), with non-finite
	// figures zeroed, but left out of the schedule: one bad row must not break /api/state.
	fin := func(x float64) float64 {
		if math.IsInf(x, 0) || math.IsNaN(x) {
			return 0
		}
		return x
	}
	var ok []Loan
	for _, l := range loans {
		end := addMonths(l.start(), l.TotalMonths)
		views = append(views, LoanView{l, l.GraceEnd(), fin(l.Payment(now)), fin(l.Principal * l.Rate / 12), fin(l.levelPayment()), fin(l.Balance(now)), end.Format("2006-01-02")})
		if validLoan(l) == "" {
			ok = append(ok, l)
		}
	}
	loans = ok
	if len(loans) == 0 {
		return views, sched
	}
	first, last := loans[0].start(), loans[0].start()
	for _, l := range loans {
		end := addMonths(l.start(), l.TotalMonths)
		if l.start().Before(first) {
			first = l.start()
		}
		if end.After(last) {
			last = end
		}
	}
	for m := time.Date(first.Year(), first.Month()+1, 1, 0, 0, 0, 0, time.UTC); !m.After(last); m = m.AddDate(0, 1, 0) {
		row := MonthPay{Month: m.Format("2006-01"), By: map[int64]float64{}}
		for _, l := range loans {
			if p := l.Payment(m); p > 0 {
				row.By[l.ID] = p
				row.Total += p
			}
		}
		sched = append(sched, row)
	}
	return views, sched
}
