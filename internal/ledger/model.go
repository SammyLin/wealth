package ledger

import (
	"math"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Kind is a user-defined account class (table account_kinds). Accounts of a kind whose
// liquidity is "liability" are entered as positive numbers and subtracted.
type Kind struct {
	Key       string `json:"key"`
	Name      string `json:"name"`
	Color     string `json:"color"`
	Liquidity string `json:"liquidity"`
	Sort      int    `json:"sort"`
}

var (
	kindKeyRe = regexp.MustCompile(`^[a-z][a-z0-9_]{1,31}$`)
	colorRe   = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
)

func validLiquidity(s string) bool {
	return s == "liquid" || s == "invest" || s == "fixed" || s == "liability"
}

// validKindFields checks everything but the key, which PUT /api/kinds/:key takes from the URL.
func validKindFields(k Kind) string {
	switch {
	case strings.TrimSpace(k.Name) == "" || len([]rune(k.Name)) > 30:
		return "類別名稱必填,最多 30 字"
	case !colorRe.MatchString(k.Color):
		return "顏色格式要是 #rrggbb"
	case !validLiquidity(k.Liquidity):
		return "流動性要是 liquid、invest、fixed 或 liability"
	case k.Sort < -maxSort || k.Sort > maxSort:
		return "排序值超出範圍"
	}
	return ""
}

type Account struct {
	ID       int64   `json:"id"`
	Name     string  `json:"name"`
	Kind     string  `json:"kind"`
	Currency string  `json:"currency"`
	Archived bool    `json:"archived"`
	Sort     int     `json:"sort"`
	Note     string  `json:"note"`
	Amount   float64 `json:"amount"` // latest, original currency
	FX       float64 `json:"fx"`     // latest rate to the base currency
	History  []Point `json:"history"`
}

type Point struct {
	Date   string  `json:"date"`
	Value  float64 `json:"value"` // in base currency
	Amount float64 `json:"amount"`
	FX     float64 `json:"fx"`
}

type Snapshot struct {
	AccountID int64   `json:"account_id"`
	Date      string  `json:"date"`
	Amount    float64 `json:"amount"`
	FX        float64 `json:"fx"`
}

type Row struct {
	Date   string             `json:"date"`
	Total  float64            `json:"total"`
	ByKind map[string]float64 `json:"by_kind"`
}

type Event struct {
	ID    int64  `json:"id"`
	Date  string `json:"date"`
	Title string `json:"title"`
}

// series carries each account's last known balance forward to every snapshot date,
// so updating one account doesn't make the others look like they dropped to zero.
// ponytail: recomputed per request, O(dates*accounts); fine for a personal ledger.
// Sign comes from the kind's liquidity, so a user-defined liability kind subtracts too.
func series(snaps []Snapshot, kindOf map[int64]string, kinds map[string]Kind) []Row {
	return seriesWithLoans(snaps, kindOf, kinds, nil)
}

// seriesWithLoans is series, except that a liability account linked to loans follows its loan schedule between
// records: on a date after its last record, the balance is the recorded one moved by what the schedule says was
// repaid since (the recorded figure stays authoritative, so a bank's rounding or a lump-sum payment is kept).
// A forgotten mortgage then keeps falling instead of flat-lining, and the trend moves even when only assets are
// recorded.
func seriesWithLoans(snaps []Snapshot, kindOf map[int64]string, kinds map[string]Kind, loans []Loan) []Row {
	sort.SliceStable(snaps, func(i, j int) bool { return snaps[i].Date < snaps[j].Date })
	byAcct := map[int64][]Loan{}
	for _, l := range loans {
		if l.AccountID != nil && validLoan(l) == "" && kinds[kindOf[*l.AccountID]].Liquidity == "liability" {
			byAcct[*l.AccountID] = append(byAcct[*l.AccountID], l)
		}
	}
	owed := func(id int64, date string) float64 {
		d, _ := time.Parse("2006-01-02", date)
		var sum float64
		for _, l := range byAcct[id] {
			sum += l.Balance(d)
		}
		return sum
	}
	last, lastDate := map[int64]float64{}, map[int64]string{}
	var rows []Row
	for i, s := range snaps {
		v := s.Amount * s.FX
		if kinds[kindOf[s.AccountID]].Liquidity == "liability" {
			v = -v
		}
		last[s.AccountID], lastDate[s.AccountID] = v, s.Date
		if i+1 < len(snaps) && snaps[i+1].Date == s.Date {
			continue
		}
		r := Row{Date: s.Date, ByKind: map[string]float64{}}
		for id, v := range last {
			if _, ok := byAcct[id]; ok && lastDate[id] < s.Date {
				// v is -(recorded owed); take off what the schedule repaid since the record (owed never below zero)
				repaid := owed(id, lastDate[id]) - owed(id, s.Date)
				v = -math.Max(0, -v-repaid)
			}
			r.ByKind[kindOf[id]] += v
			r.Total += v
		}
		rows = append(rows, r)
	}
	return rows
}

// Bounds keep every stored figure encodable as JSON (no Inf/NaN) and far from float precision trouble.
const (
	maxAmount = 1e15
	maxFX     = 1e12
)

// validSnapshot is shared by POST /api/snapshots and the CSV import. The comparisons are false for NaN.
// Callers check futureDate first so they can say why.
func validSnapshot(s Snapshot) bool {
	return validDate(s.Date) && !futureDate(s.Date) && math.Abs(s.Amount) <= maxAmount && s.FX > 0 && s.FX <= maxFX
}

// validDate takes YYYY-MM-DD in 1900–2199: wide enough for any household record or 40-year mortgage,
// narrow enough that a typo can't make loanViews build a schedule across millennia.
func validDate(s string) bool {
	t, err := time.Parse("2006-01-02", s)
	return err == nil && t.Year() >= 1900 && t.Year() < 2200
}

// outOfRange: a real YYYY-MM-DD outside validDate's years, so the message can say "range" rather than "format".
func outOfRange(s string) bool {
	_, err := time.Parse("2006-01-02", s)
	return err == nil && !validDate(s)
}

// futureDate: a balance can't be recorded for a day that hasn't happened. One day of slack covers the
// user's time zone being ahead of the server's.
func futureDate(s string) bool { return s > time.Now().AddDate(0, 0, 1).Format("2006-01-02") }

// validCurrency: three ASCII letters, checked on the raw bytes (upper-casing first let "ıd" through as "ID").
func validCurrency(s string) bool {
	return len(s) == 3 && strings.Trim(s, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz") == ""
}

func validLoan(l Loan) string {
	switch {
	case strings.TrimSpace(l.Name) == "" || !(l.Principal > 0):
		return "名稱和本金必填"
	case len([]rune(strings.TrimSpace(l.Name))) > maxName:
		return "文字太長"
	case l.Principal > maxAmount:
		return "本金太大"
	case l.Rate < 0 || l.Rate > 0.2:
		return "年利率要在 0–20% 之間"
	case l.TotalMonths <= 0 || l.TotalMonths > 600 || l.GraceMonths < 0 || l.GraceMonths >= l.TotalMonths:
		return "總期數 1–600 個月,寬限期要小於總期數"
	case outOfRange(l.Start):
		return "日期要在 1900–2199 年之間"
	case !validDate(l.Start):
		return "起始日期格式錯誤"
	}
	return ""
}
