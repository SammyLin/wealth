package ledger

import (
	"sort"
	"strings"
	"time"
)

// Kinds of account. Liabilities are entered as positive numbers and subtracted.
var kinds = map[string]bool{"bank": true, "tw_stock": true, "us_stock": true, "movable": true, "real_estate": true, "crypto": true, "liability": true}

type Account struct {
	ID       int64   `json:"id"`
	Name     string  `json:"name"`
	Kind     string  `json:"kind"`
	Currency string  `json:"currency"`
	Archived bool    `json:"archived"`
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
func series(snaps []Snapshot, kindOf map[int64]string) []Row {
	sort.SliceStable(snaps, func(i, j int) bool { return snaps[i].Date < snaps[j].Date })
	last := map[int64]float64{}
	var rows []Row
	for i, s := range snaps {
		v := s.Amount * s.FX
		if kindOf[s.AccountID] == "liability" {
			v = -v
		}
		last[s.AccountID] = v
		if i+1 < len(snaps) && snaps[i+1].Date == s.Date {
			continue
		}
		r := Row{Date: s.Date, ByKind: map[string]float64{}}
		for id, v := range last {
			r.ByKind[kindOf[id]] += v
			r.Total += v
		}
		rows = append(rows, r)
	}
	return rows
}

func validDate(s string) bool { _, err := time.Parse("2006-01-02", s); return err == nil }

func validCurrency(s string) bool {
	return len(s) == 3 && strings.Trim(strings.ToUpper(s), "ABCDEFGHIJKLMNOPQRSTUVWXYZ") == ""
}

func validLoan(l Loan) string {
	switch {
	case strings.TrimSpace(l.Name) == "" || l.Principal <= 0:
		return "名稱和本金必填"
	case l.Rate < 0 || l.Rate > 0.2:
		return "年利率要在 0–20% 之間"
	case l.TotalMonths <= 0 || l.TotalMonths > 600 || l.GraceMonths < 0 || l.GraceMonths >= l.TotalMonths:
		return "總期數 1–600 個月,寬限期要小於總期數"
	case !validDate(l.Start):
		return "起始日期格式錯誤"
	}
	return ""
}
