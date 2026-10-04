package ledger

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// state is GET /api/state: everything the UI draws, in one response. ?today=YYYY-MM-DD is the browser's local
// date, so "this month's payment" agrees with the UI around a month boundary even when the server runs in UTC.
func (h *api) state(fileBackups bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx, db := c.Request.Context(), h.db
		set, err := settings(ctx, db)
		if fail(c, err) {
			return
		}
		kinds, err := listKinds(ctx, db)
		if fail(c, err) {
			return
		}
		accts, kindOf := []*Account{}, map[int64]string{}
		byID := map[int64]*Account{}
		err = queryEach(ctx, db, `SELECT id, name, kind, currency, archived, sort, note FROM accounts ORDER BY sort, id`, func(rows *sql.Rows) error {
			a := &Account{FX: 1, History: []Point{}}
			if err := rows.Scan(&a.ID, &a.Name, &a.Kind, &a.Currency, &a.Archived, &a.Sort, &a.Note); err != nil {
				return err
			}
			accts, byID[a.ID], kindOf[a.ID] = append(accts, a), a, a.Kind
			return nil
		})
		if fail(c, err) {
			return
		}

		snaps := []Snapshot{}
		err = queryEach(ctx, db, `SELECT account_id, date, amount, fx FROM snapshots ORDER BY date`, func(rows *sql.Rows) error {
			var s Snapshot
			if err := rows.Scan(&s.AccountID, &s.Date, &s.Amount, &s.FX); err != nil {
				return err
			}
			if a := byID[s.AccountID]; a != nil {
				snaps = append(snaps, s)
				a.Amount, a.FX = s.Amount, s.FX
				a.History = append(a.History, Point{s.Date, s.Amount * s.FX, s.Amount, s.FX})
			}
			return nil
		})
		if fail(c, err) {
			return
		}

		events := []Event{}
		err = queryEach(ctx, db, `SELECT id, date, title FROM events ORDER BY date, id`, func(rows *sql.Rows) error {
			var e Event
			if err := rows.Scan(&e.ID, &e.Date, &e.Title); err != nil {
				return err
			}
			events = append(events, e)
			return nil
		})
		if fail(c, err) {
			return
		}

		loans, err := listLoans(ctx, db)
		if fail(c, err) {
			return
		}
		now := time.Now()
		if d := c.Query("today"); validDate(d) {
			now, _ = time.Parse("2006-01-02", d)
		}
		views, sched := loanViews(loans, now)

		s := seriesWithLoans(snaps, kindOf, kindMap(kinds), loans)
		if s == nil {
			s = []Row{}
		}
		// Marshal first: c.JSON would send an empty 200 if a value can't be encoded (e.g. +Inf).
		b, err := json.Marshal(gin.H{"file_backups": fileBackups, "settings": set, "kinds": kinds, "accounts": accts, "series": s, "events": events, "loans": views, "loan_schedule": sched})
		if fail(c, err) {
			return
		}
		c.Data(http.StatusOK, "application/json; charset=utf-8", b)
	}
}
