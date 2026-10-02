package ledger

import (
	"crypto/sha256"
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/SammyLin/wealth"
)

// New holds every page and API route. cmd/wealth's server.go (local SQLite) and worker.go
// (Cloudflare Workers + D1) only differ in how they open db and serve the router.
// fileBackups tells the UI a .db download and daily backups exist (self-hosted only;
// on Workers, D1 Time Travel covers backups instead).
func New(db *sql.DB, fileBackups bool, middleware ...gin.HandlerFunc) *gin.Engine {
	r := gin.New()
	r.Use(append([]gin.HandlerFunc{gin.Recovery()}, middleware...)...)

	// icons.js is cached for a day, so the page links it by content hash: a new build means a new URL.
	icons, _ := wealth.Web.ReadFile("web/icons.js")
	page, _ := wealth.Web.ReadFile("web/index.html")
	sum := sha256.Sum256(icons)
	page = []byte(strings.Replace(string(page), `src="/icons.js"`, fmt.Sprintf(`src="/icons.js?v=%x"`, sum[:6]), 1))
	r.GET("/", func(c *gin.Context) {
		c.Header("Cache-Control", "no-cache")
		c.Data(http.StatusOK, "text/html; charset=utf-8", page)
	})
	r.GET("/icons.js", func(c *gin.Context) {
		c.Header("Cache-Control", "public, max-age=31536000, immutable")
		c.Data(http.StatusOK, "text/javascript; charset=utf-8", icons)
	})

	r.GET("/api/state", func(c *gin.Context) {
		set, err := settings(db)
		if fail(c, err) {
			return
		}
		accts, kindOf := []*Account{}, map[int64]string{}
		byID := map[int64]*Account{}
		rows, err := db.Query(`SELECT id, name, kind, currency, archived FROM accounts ORDER BY id`)
		if fail(c, err) {
			return
		}
		for rows.Next() {
			a := &Account{FX: 1, History: []Point{}}
			rows.Scan(&a.ID, &a.Name, &a.Kind, &a.Currency, &a.Archived)
			accts, byID[a.ID], kindOf[a.ID] = append(accts, a), a, a.Kind
		}
		rows.Close()

		snaps := []Snapshot{}
		rows, err = db.Query(`SELECT account_id, date, amount, fx FROM snapshots ORDER BY date`)
		if fail(c, err) {
			return
		}
		for rows.Next() {
			var s Snapshot
			rows.Scan(&s.AccountID, &s.Date, &s.Amount, &s.FX)
			a := byID[s.AccountID]
			if a == nil {
				continue
			}
			snaps = append(snaps, s)
			a.Amount, a.FX = s.Amount, s.FX
			a.History = append(a.History, Point{s.Date, s.Amount * s.FX, s.Amount, s.FX})
		}
		rows.Close()

		events := []Event{}
		rows, err = db.Query(`SELECT id, date, title FROM events ORDER BY date, id`)
		if fail(c, err) {
			return
		}
		for rows.Next() {
			var e Event
			rows.Scan(&e.ID, &e.Date, &e.Title)
			events = append(events, e)
		}
		rows.Close()

		loans, err := listLoans(db)
		if fail(c, err) {
			return
		}
		views, sched := loanViews(loans, time.Now())

		s := series(snaps, kindOf)
		if s == nil {
			s = []Row{}
		}
		c.JSON(http.StatusOK, gin.H{"file_backups": fileBackups, "settings": set, "accounts": accts, "series": s, "events": events, "loans": views, "loan_schedule": sched})
	})

	r.PUT("/api/settings", func(c *gin.Context) {
		var in map[string]string
		if c.ShouldBindJSON(&in) != nil {
			c.Status(http.StatusBadRequest)
			return
		}
		for k, v := range in {
			if _, ok := defaultSettings[k]; !ok {
				continue
			}
			v = strings.TrimSpace(v)
			if k == "base_currency" {
				v = strings.ToUpper(v)
				if !validCurrency(v) {
					c.JSON(http.StatusBadRequest, gin.H{"error": "基準幣別要是三個英文字母,例如 TWD、USD"})
					return
				}
				cur, err := settings(db)
				if fail(c, err) {
					return
				}
				// every stored fx is "to the base currency", so the base can only change before any balance is recorded
				var n int
				db.QueryRow(`SELECT COUNT(*) FROM snapshots`).Scan(&n)
				if v != cur["base_currency"] && n > 0 {
					c.JSON(http.StatusConflict, gin.H{"error": "已經有餘額紀錄,基準幣別不能再改(舊匯率都是對原本的幣別)"})
					return
				}
			}
			if len([]rune(v)) > 60 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "文字太長"})
				return
			}
			if _, err := db.Exec(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, k, v); fail(c, err) {
				return
			}
		}
		c.Status(http.StatusNoContent)
	})

	r.POST("/api/accounts", func(c *gin.Context) {
		var a Account
		if c.ShouldBindJSON(&a) != nil || strings.TrimSpace(a.Name) == "" || !kinds[a.Kind] {
			c.JSON(http.StatusBadRequest, gin.H{"error": "名稱和類別必填"})
			return
		}
		if a.Currency == "" {
			set, err := settings(db)
			if fail(c, err) {
				return
			}
			a.Currency = set["base_currency"]
		}
		if !validCurrency(a.Currency) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "幣別要是三個英文字母"})
			return
		}
		res, err := db.Exec(`INSERT INTO accounts (name, kind, currency) VALUES (?, ?, ?)`, strings.TrimSpace(a.Name), a.Kind, strings.ToUpper(a.Currency))
		if fail(c, err) {
			return
		}
		a.ID, _ = res.LastInsertId()
		c.JSON(http.StatusOK, a)
	})

	// Edit name / kind / archived. Archive instead of delete: history stays in the trend.
	r.PATCH("/api/accounts/:id", func(c *gin.Context) {
		var body struct {
			Name     *string `json:"name"`
			Kind     *string `json:"kind"`
			Currency *string `json:"currency"`
			Archived *bool   `json:"archived"`
		}
		if c.ShouldBindJSON(&body) != nil {
			c.Status(http.StatusBadRequest)
			return
		}
		id := c.Param("id")
		if body.Name != nil {
			if strings.TrimSpace(*body.Name) == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "名稱不能空白"})
				return
			}
			if _, err := db.Exec(`UPDATE accounts SET name=? WHERE id=?`, strings.TrimSpace(*body.Name), id); fail(c, err) {
				return
			}
		}
		if body.Kind != nil {
			if !kinds[*body.Kind] {
				c.JSON(http.StatusBadRequest, gin.H{"error": "類別不正確"})
				return
			}
			if _, err := db.Exec(`UPDATE accounts SET kind=? WHERE id=?`, *body.Kind, id); fail(c, err) {
				return
			}
		}
		if body.Currency != nil {
			var n int
			db.QueryRow(`SELECT COUNT(*) FROM snapshots WHERE account_id=?`, id).Scan(&n)
			if !validCurrency(*body.Currency) || n > 0 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "幣別只能在還沒記錄餘額前修改"})
				return
			}
			if _, err := db.Exec(`UPDATE accounts SET currency=? WHERE id=?`, strings.ToUpper(*body.Currency), id); fail(c, err) {
				return
			}
		}
		if body.Archived != nil {
			if _, err := db.Exec(`UPDATE accounts SET archived=? WHERE id=?`, *body.Archived, id); fail(c, err) {
				return
			}
		}
		c.Status(http.StatusNoContent)
	})

	// Delete an account and its whole history (for mistakes or accounts that shouldn't be counted).
	// Loans that pointed at it stay, unlinked. No transactions on D1, so order keeps it consistent.
	r.DELETE("/api/accounts/:id", func(c *gin.Context) {
		id := c.Param("id")
		for _, q := range []string{`DELETE FROM snapshots WHERE account_id=?`, `UPDATE loans SET account_id=NULL WHERE account_id=?`, `DELETE FROM accounts WHERE id=?`} {
			if _, err := db.Exec(q, id); fail(c, err) {
				return
			}
		}
		c.Status(http.StatusNoContent)
	})

	// Batch upsert: one form submits every account's balance for a date. D1 has no transactions
	// and caps bound parameters at 100, so rows go in multi-row statements of 20; an upsert is
	// idempotent, so a retry after a partial failure is safe.
	r.POST("/api/snapshots", func(c *gin.Context) {
		var in []Snapshot
		if c.ShouldBindJSON(&in) != nil {
			c.Status(http.StatusBadRequest)
			return
		}
		for _, s := range in {
			if !validDate(s.Date) || s.FX <= 0 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "日期或匯率不正確"})
				return
			}
		}
		for i := 0; i < len(in); i += 20 {
			chunk := in[i:min(i+20, len(in))]
			args := make([]any, 0, len(chunk)*4)
			for _, s := range chunk {
				args = append(args, s.AccountID, s.Date, s.Amount, s.FX)
			}
			q := `INSERT INTO snapshots (account_id, date, amount, fx) VALUES ` +
				strings.TrimSuffix(strings.Repeat("(?, ?, ?, ?),", len(chunk)), ",") +
				` ON CONFLICT(account_id, date) DO UPDATE SET amount=excluded.amount, fx=excluded.fx`
			if _, err := db.Exec(q, args...); fail(c, err) {
				return
			}
		}
		c.Status(http.StatusNoContent)
	})

	r.DELETE("/api/snapshots", func(c *gin.Context) {
		if _, err := db.Exec(`DELETE FROM snapshots WHERE account_id=? AND date=?`, c.Query("account_id"), c.Query("date")); fail(c, err) {
			return
		}
		c.Status(http.StatusNoContent)
	})

	saveEvent := func(c *gin.Context) {
		var e Event
		if c.ShouldBindJSON(&e) != nil || strings.TrimSpace(e.Title) == "" || !validDate(e.Date) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "日期和事件名稱必填"})
			return
		}
		e.Title = strings.TrimSpace(e.Title)
		if id := c.Param("id"); id != "" {
			if _, err := db.Exec(`UPDATE events SET date=?, title=? WHERE id=?`, e.Date, e.Title, id); fail(c, err) {
				return
			}
			e.ID, _ = strconv.ParseInt(id, 10, 64)
		} else {
			res, err := db.Exec(`INSERT INTO events (date, title) VALUES (?, ?)`, e.Date, e.Title)
			if fail(c, err) {
				return
			}
			e.ID, _ = res.LastInsertId()
		}
		c.JSON(http.StatusOK, e)
	}
	r.POST("/api/events", saveEvent)
	r.PUT("/api/events/:id", saveEvent)
	r.DELETE("/api/events/:id", func(c *gin.Context) {
		if _, err := db.Exec(`DELETE FROM events WHERE id=?`, c.Param("id")); fail(c, err) {
			return
		}
		c.Status(http.StatusNoContent)
	})

	saveLoan := func(c *gin.Context) {
		var l Loan
		if c.ShouldBindJSON(&l) != nil {
			c.Status(http.StatusBadRequest)
			return
		}
		if msg := validLoan(l); msg != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": msg})
			return
		}
		l.Name = strings.TrimSpace(l.Name)
		if id := c.Param("id"); id != "" {
			_, err := db.Exec(`UPDATE loans SET account_id=?, name=?, principal=?, rate=?, start=?, grace_months=?, total_months=? WHERE id=?`,
				l.AccountID, l.Name, l.Principal, l.Rate, l.Start, l.GraceMonths, l.TotalMonths, id)
			if fail(c, err) {
				return
			}
			l.ID, _ = strconv.ParseInt(id, 10, 64)
		} else {
			res, err := db.Exec(`INSERT INTO loans (account_id, name, principal, rate, start, grace_months, total_months) VALUES (?, ?, ?, ?, ?, ?, ?)`,
				l.AccountID, l.Name, l.Principal, l.Rate, l.Start, l.GraceMonths, l.TotalMonths)
			if fail(c, err) {
				return
			}
			l.ID, _ = res.LastInsertId()
		}
		c.JSON(http.StatusOK, l)
	}
	r.POST("/api/loans", saveLoan)
	r.PUT("/api/loans/:id", saveLoan)
	r.DELETE("/api/loans/:id", func(c *gin.Context) {
		if _, err := db.Exec(`DELETE FROM loans WHERE id=?`, c.Param("id")); fail(c, err) {
			return
		}
		c.Status(http.StatusNoContent)
	})

	r.GET("/api/export.csv", func(c *gin.Context) {
		b, err := exportCSV(db)
		if fail(c, err) {
			return
		}
		c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="wealth-%s.csv"`, time.Now().Format("2006-01-02")))
		c.Data(http.StatusOK, "text/csv; charset=utf-8", b)
	})

	r.GET("/api/fx", func(c *gin.Context) {
		set, err := settings(db)
		if fail(c, err) {
			return
		}
		rate, err := fetchFX(c.Query("cur"), set["base_currency"], c.Query("date"))
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"rate": rate})
	})

	return r
}

func fail(c *gin.Context, err error) bool {
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return true
	}
	return false
}
