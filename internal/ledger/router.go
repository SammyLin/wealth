package ledger

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	maxNote = 200
	maxName = 60 // account names, in runes
)

// New holds every page and API route. cmd/wealth's server.go (local SQLite) and worker.go
// (Cloudflare Workers + D1) only differ in how they open db and serve the router.
// fileBackups tells the UI a .db download and daily backups exist (self-hosted only;
// on Workers, D1 Time Travel covers backups instead).
func New(db *sql.DB, fileBackups bool, middleware ...gin.HandlerFunc) *gin.Engine {
	r := gin.New()
	r.Use(append([]gin.HandlerFunc{gin.Recovery(), guardWrites}, middleware...)...)

	serveSPA(r)

	// For a container healthcheck; server.go lets it past basic auth.
	r.GET("/healthz", func(c *gin.Context) {
		if err := db.PingContext(c.Request.Context()); err != nil {
			c.String(http.StatusServiceUnavailable, "db unavailable")
			return
		}
		c.String(http.StatusOK, "ok")
	})

	r.GET("/api/state", func(c *gin.Context) {
		ctx := c.Request.Context()
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
		views, sched := loanViews(loans, time.Now())

		s := series(snaps, kindOf, kindMap(kinds))
		if s == nil {
			s = []Row{}
		}
		// Marshal first: c.JSON would send an empty 200 if a value can't be encoded (e.g. +Inf).
		b, err := json.Marshal(gin.H{"file_backups": fileBackups, "settings": set, "kinds": kinds, "accounts": accts, "series": s, "events": events, "loans": views, "loan_schedule": sched})
		if fail(c, err) {
			return
		}
		c.Data(http.StatusOK, "application/json; charset=utf-8", b)
	})

	r.PUT("/api/settings", func(c *gin.Context) {
		var in map[string]string
		if c.ShouldBindJSON(&in) != nil {
			bad(c, http.StatusBadRequest, "格式不正確")
			return
		}
		ctx := c.Request.Context()
		clean := map[string]string{}
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
				cur, err := settings(ctx, db)
				if fail(c, err) {
					return
				}
				// every stored fx is "to the base currency", so the base can only change before any balance is recorded
				var n int
				if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM snapshots`).Scan(&n); fail(c, err) {
					return
				}
				if v != cur["base_currency"] && n > 0 {
					c.JSON(http.StatusConflict, gin.H{"error": "已經有餘額紀錄,基準幣別不能再改(舊匯率都是對原本的幣別)"})
					return
				}
			}
			switch k {
			case "title":
				if v == "" {
					bad(c, http.StatusBadRequest, "名稱不能空白")
					return
				}
				if len([]rune(v)) > 60 {
					bad(c, http.StatusBadRequest, "文字太長")
					return
				}
			case "unit":
				if v != "wan" && v != "k" && v != "full" {
					c.JSON(http.StatusBadRequest, gin.H{"error": "單位要是 wan、k 或 full"})
					return
				}
			case "layout":
				if len(v) > maxLayoutBytes || !json.Valid([]byte(v)) {
					c.JSON(http.StatusBadRequest, gin.H{"error": "版面設定要是 4 KB 以內的 JSON"})
					return
				}
			default:
				if len([]rune(v)) > 60 {
					c.JSON(http.StatusBadRequest, gin.H{"error": "文字太長"})
					return
				}
			}
			clean[k] = v
		}
		for k, v := range clean {
			if _, err := db.ExecContext(ctx, `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, k, v); fail(c, err) {
				return
			}
		}
		c.Status(http.StatusNoContent)
	})

	r.POST("/api/accounts", func(c *gin.Context) {
		var a Account
		if c.ShouldBindJSON(&a) != nil || strings.TrimSpace(a.Name) == "" {
			bad(c, http.StatusBadRequest, "名稱和類別必填")
			return
		}
		a.Name, a.Note = strings.TrimSpace(a.Name), strings.TrimSpace(a.Note)
		if len([]rune(a.Name)) > maxName {
			bad(c, http.StatusBadRequest, "名稱最多 {} 字", maxName)
			return
		}
		if len([]rune(a.Note)) > maxNote {
			bad(c, http.StatusBadRequest, "備註太長")
			return
		}
		if a.Currency == "" {
			set, err := settings(c.Request.Context(), db)
			if fail(c, err) {
				return
			}
			a.Currency = set["base_currency"]
		}
		if !validCurrency(a.Currency) {
			bad(c, http.StatusBadRequest, "幣別要是三個英文字母")
			return
		}
		// new accounts go last; the client can't pick the position here (PUT /api/accounts/order does that)
		if err := db.QueryRowContext(c.Request.Context(), `SELECT COALESCE(MAX(sort), -1) + 1 FROM accounts`).Scan(&a.Sort); fail(c, err) {
			return
		}
		a.Currency, a.Archived, a.FX, a.History = strings.ToUpper(a.Currency), false, 1, []Point{}
		// The EXISTS makes "the kind exists" and the insert one statement (no transactions on D1),
		// so a kind deleted a moment earlier can't end up with an account.
		res, err := db.ExecContext(c.Request.Context(), `INSERT INTO accounts (name, kind, currency, sort, note) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM account_kinds WHERE key=?)`,
			a.Name, a.Kind, a.Currency, a.Sort, a.Note, a.Kind)
		if fail(c, err) {
			return
		}
		if n, err := res.RowsAffected(); fail(c, err) {
			return
		} else if n == 0 {
			bad(c, http.StatusBadRequest, "名稱和類別必填")
			return
		}
		if a.ID, err = res.LastInsertId(); fail(c, err) {
			return
		}
		c.JSON(http.StatusCreated, a)
	})

	// Edit name / kind / currency / archived / sort / note. Archive instead of delete: history stays in the trend.
	// Everything is validated before the single UPDATE, so a bad field changes nothing.
	r.PATCH("/api/accounts/:id", func(c *gin.Context) {
		var body struct {
			Name     *string `json:"name"`
			Kind     *string `json:"kind"`
			Currency *string `json:"currency"`
			Archived *bool   `json:"archived"`
			Sort     *int    `json:"sort"`
			Note     *string `json:"note"`
		}
		if c.ShouldBindJSON(&body) != nil {
			bad(c, http.StatusBadRequest, "格式不正確")
			return
		}
		id, ctx := c.Param("id"), c.Request.Context()
		var snaps int
		if found, err := accountExists(ctx, db, id); fail(c, err) {
			return
		} else if !found {
			bad(c, http.StatusNotFound, "找不到這個帳戶")
			return
		}
		var sets []string
		var args []any
		set := func(col string, v any) { sets, args = append(sets, col+"=?"), append(args, v) }
		if body.Name != nil {
			name := strings.TrimSpace(*body.Name)
			if name == "" {
				bad(c, http.StatusBadRequest, "名稱不能空白")
				return
			}
			if len([]rune(name)) > maxName {
				bad(c, http.StatusBadRequest, "名稱最多 {} 字", maxName)
				return
			}
			set("name", name)
		}
		if body.Kind != nil {
			ok, err := kindExists(ctx, db, *body.Kind)
			if fail(c, err) {
				return
			}
			if !ok {
				bad(c, http.StatusBadRequest, "類別不正確")
				return
			}
			set("kind", *body.Kind)
		}
		if body.Currency != nil {
			if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM snapshots WHERE account_id=?`, id).Scan(&snaps); fail(c, err) {
				return
			}
			if !validCurrency(*body.Currency) {
				bad(c, http.StatusBadRequest, "幣別要是三個英文字母")
				return
			}
			if snaps > 0 {
				bad(c, http.StatusBadRequest, "幣別只能在還沒記錄餘額前修改")
				return
			}
			set("currency", strings.ToUpper(*body.Currency))
		}
		if body.Archived != nil {
			set("archived", *body.Archived)
		}
		if body.Sort != nil {
			set("sort", *body.Sort)
		}
		if body.Note != nil {
			note := strings.TrimSpace(*body.Note)
			if len([]rune(note)) > maxNote {
				bad(c, http.StatusBadRequest, "備註太長")
				return
			}
			set("note", note)
		}
		if len(sets) > 0 {
			if _, err := db.ExecContext(ctx, `UPDATE accounts SET `+strings.Join(sets, ", ")+` WHERE id=?`, append(args, id)...); fail(c, err) {
				return
			}
		}
		c.Status(http.StatusNoContent)
	})

	// Reorder: sort = position in ids. D1 caps a statement at 100 bound parameters; each id binds twice
	// (WHEN and IN, the position is inlined as an int), so 40 ids per statement stays at 80.
	r.PUT("/api/accounts/order", func(c *gin.Context) {
		var in struct {
			IDs []int64 `json:"ids"`
		}
		if c.ShouldBindJSON(&in) != nil || len(in.IDs) > 5000 {
			bad(c, http.StatusBadRequest, "ids 格式不正確")
			return
		}
		seen := map[int64]bool{}
		keys := make([]any, len(in.IDs))
		for i, id := range in.IDs {
			if id <= 0 || seen[id] {
				bad(c, http.StatusBadRequest, "ids 不能重複")
				return
			}
			seen[id], keys[i] = true, id
		}
		if fail(c, setOrder(c.Request.Context(), db, "accounts", "id", keys)) {
			return
		}
		c.Status(http.StatusNoContent)
	})

	// Delete an account and its whole history (for mistakes or accounts that shouldn't be counted).
	// Loans that pointed at it stay, unlinked. No transactions on D1, so order keeps it consistent.
	r.DELETE("/api/accounts/:id", func(c *gin.Context) {
		id := c.Param("id")
		if found, err := accountExists(c.Request.Context(), db, id); fail(c, err) {
			return
		} else if !found {
			bad(c, http.StatusNotFound, "找不到這個帳戶")
			return
		}
		for _, q := range []string{`DELETE FROM snapshots WHERE account_id=?`, `UPDATE loans SET account_id=NULL WHERE account_id=?`, `DELETE FROM accounts WHERE id=?`} {
			if _, err := db.ExecContext(c.Request.Context(), q, id); fail(c, err) {
				return
			}
		}
		c.Status(http.StatusNoContent)
	})

	// Batch upsert: one form submits every account's balance for a date (see upsertSnapshots for the D1 limits).
	r.POST("/api/snapshots", func(c *gin.Context) {
		var in []Snapshot
		if c.ShouldBindJSON(&in) != nil {
			bad(c, http.StatusBadRequest, "格式不正確")
			return
		}
		for _, s := range in {
			if futureDate(s.Date) {
				bad(c, http.StatusBadRequest, "日期不能在未來")
				return
			}
			if !validSnapshot(s) {
				bad(c, http.StatusBadRequest, "日期、金額或匯率不正確")
				return
			}
		}
		curOf, err := accountCurrencies(c.Request.Context(), db)
		if fail(c, err) {
			return
		}
		set, err := settings(c.Request.Context(), db)
		if fail(c, err) {
			return
		}
		for _, s := range in {
			cur, ok := curOf[s.AccountID]
			if !ok {
				bad(c, http.StatusBadRequest, "找不到這個帳戶")
				return
			}
			// fx is "to the base currency": anything but 1 would silently multiply a base-currency balance
			if cur == set["base_currency"] && s.FX != 1 {
				bad(c, http.StatusBadRequest, "基準幣別的帳戶匯率只能是 1")
				return
			}
		}
		if err := upsertSnapshots(c.Request.Context(), db, in); fail(c, err) {
			return
		}
		c.Status(http.StatusNoContent)
	})

	r.DELETE("/api/snapshots", func(c *gin.Context) {
		res, err := db.ExecContext(c.Request.Context(), `DELETE FROM snapshots WHERE account_id=? AND date=?`, c.Query("account_id"), c.Query("date"))
		noContentOr404(c, res, err, "找不到這筆紀錄")
	})

	r.POST("/api/import", func(c *gin.Context) { importBalances(c, db) })

	r.POST("/api/kinds", func(c *gin.Context) {
		var k Kind
		if c.ShouldBindJSON(&k) != nil || !kindKeyRe.MatchString(k.Key) {
			bad(c, http.StatusBadRequest, "代號要是小寫英文開頭,2–32 個小寫英文、數字或底線")
			return
		}
		if msg := validKindFields(k); msg != "" {
			bad(c, http.StatusBadRequest, msg)
			return
		}
		k.Name, k.Color = strings.TrimSpace(k.Name), strings.ToLower(k.Color)
		exists, err := kindExists(c.Request.Context(), db, k.Key)
		if fail(c, err) {
			return
		}
		if exists {
			bad(c, http.StatusConflict, "這個代號已經存在")
			return
		}
		if taken, err := kindNameTaken(c.Request.Context(), db, k.Name, k.Key); fail(c, err) {
			return
		} else if taken {
			bad(c, http.StatusConflict, "已經有同名的類別")
			return
		}
		if _, err := db.ExecContext(c.Request.Context(), `INSERT INTO account_kinds (key, name, color, liquidity, sort) VALUES (?, ?, ?, ?, ?)`, k.Key, k.Name, k.Color, k.Liquidity, k.Sort); fail(c, err) {
			return
		}
		c.JSON(http.StatusCreated, k)
	})

	// Reorder kinds in one request (same chunked CASE as accounts), instead of one PUT per kind.
	r.PUT("/api/kinds/order", func(c *gin.Context) {
		var in struct {
			Keys []string `json:"keys"`
		}
		if c.ShouldBindJSON(&in) != nil || len(in.Keys) > 500 {
			bad(c, http.StatusBadRequest, "格式不正確")
			return
		}
		seen := map[string]bool{}
		keys := make([]any, len(in.Keys))
		for i, k := range in.Keys {
			if !kindKeyRe.MatchString(k) || seen[k] {
				bad(c, http.StatusBadRequest, "格式不正確")
				return
			}
			seen[k], keys[i] = true, k
		}
		if fail(c, setOrder(c.Request.Context(), db, "account_kinds", "key", keys)) {
			return
		}
		c.Status(http.StatusNoContent)
	})

	r.PUT("/api/kinds/:key", func(c *gin.Context) {
		k := Kind{Key: c.Param("key")} // the body can't rename: accounts point at the key
		if c.ShouldBindJSON(&k) != nil {
			bad(c, http.StatusBadRequest, "格式不正確")
			return
		}
		k.Key = c.Param("key")
		if msg := validKindFields(k); msg != "" {
			bad(c, http.StatusBadRequest, msg)
			return
		}
		k.Name, k.Color = strings.TrimSpace(k.Name), strings.ToLower(k.Color)
		exists, err := kindExists(c.Request.Context(), db, k.Key)
		if fail(c, err) {
			return
		}
		if !exists {
			bad(c, http.StatusNotFound, "找不到這個類別")
			return
		}
		if taken, err := kindNameTaken(c.Request.Context(), db, k.Name, k.Key); fail(c, err) {
			return
		} else if taken {
			bad(c, http.StatusConflict, "已經有同名的類別")
			return
		}
		if _, err := db.ExecContext(c.Request.Context(), `UPDATE account_kinds SET name=?, color=?, liquidity=?, sort=? WHERE key=?`, k.Name, k.Color, k.Liquidity, k.Sort, k.Key); fail(c, err) {
			return
		}
		c.JSON(http.StatusOK, k)
	})

	r.DELETE("/api/kinds/:key", func(c *gin.Context) {
		ctx, key := c.Request.Context(), c.Param("key")
		var n int
		if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM accounts WHERE kind=?`, key).Scan(&n); fail(c, err) {
			return
		}
		if n > 0 {
			bad(c, http.StatusConflict, "還有 {} 個帳戶使用這個類別,請先改到別的類別", n)
			return
		}
		// the NOT EXISTS makes the check and the delete one statement, since D1 has no transactions
		res, err := db.ExecContext(ctx, `DELETE FROM account_kinds WHERE key=? AND NOT EXISTS (SELECT 1 FROM accounts WHERE kind=?)`, key, key)
		noContentOr404(c, res, err, "找不到這個類別")
	})

	saveEvent := func(c *gin.Context) {
		var e Event
		if c.ShouldBindJSON(&e) != nil || strings.TrimSpace(e.Title) == "" || !validDate(e.Date) {
			bad(c, http.StatusBadRequest, "日期和事件名稱必填")
			return
		}
		e.Title = strings.TrimSpace(e.Title)
		if len([]rune(e.Title)) > maxName {
			bad(c, http.StatusBadRequest, "文字太長")
			return
		}
		if id := c.Param("id"); id != "" {
			n, err := strconv.ParseInt(id, 10, 64)
			if err != nil {
				bad(c, http.StatusBadRequest, "id 不正確")
				return
			}
			res, err := db.ExecContext(c.Request.Context(), `UPDATE events SET date=?, title=? WHERE id=?`, e.Date, e.Title, n)
			if fail(c, err) || notFound(c, res, "找不到這件大事") {
				return
			}
			e.ID = n
			c.JSON(http.StatusOK, e)
			return
		} else {
			res, err := db.ExecContext(c.Request.Context(), `INSERT INTO events (date, title) VALUES (?, ?)`, e.Date, e.Title)
			if fail(c, err) {
				return
			}
			if e.ID, err = res.LastInsertId(); fail(c, err) {
				return
			}
		}
		c.JSON(http.StatusCreated, e)
	}
	r.POST("/api/events", saveEvent)
	r.PUT("/api/events/:id", saveEvent)
	r.DELETE("/api/events/:id", func(c *gin.Context) {
		res, err := db.ExecContext(c.Request.Context(), `DELETE FROM events WHERE id=?`, c.Param("id"))
		noContentOr404(c, res, err, "找不到這件大事")
	})

	saveLoan := func(c *gin.Context) {
		var l Loan
		if c.ShouldBindJSON(&l) != nil {
			bad(c, http.StatusBadRequest, "格式不正確")
			return
		}
		if msg := validLoan(l); msg != "" {
			bad(c, http.StatusBadRequest, msg)
			return
		}
		if l.AccountID != nil {
			if found, err := accountExists(c.Request.Context(), db, strconv.FormatInt(*l.AccountID, 10)); fail(c, err) {
				return
			} else if !found {
				bad(c, http.StatusBadRequest, "找不到這個帳戶")
				return
			}
		}
		l.Name = strings.TrimSpace(l.Name)
		if id := c.Param("id"); id != "" {
			n, err := strconv.ParseInt(id, 10, 64)
			if err != nil {
				bad(c, http.StatusBadRequest, "id 不正確")
				return
			}
			res, err := db.ExecContext(c.Request.Context(), `UPDATE loans SET account_id=?, name=?, principal=?, rate=?, start=?, grace_months=?, total_months=? WHERE id=?`,
				l.AccountID, l.Name, l.Principal, l.Rate, l.Start, l.GraceMonths, l.TotalMonths, n)
			if fail(c, err) || notFound(c, res, "找不到這筆貸款") {
				return
			}
			l.ID = n
			c.JSON(http.StatusOK, l)
			return
		} else {
			res, err := db.ExecContext(c.Request.Context(), `INSERT INTO loans (account_id, name, principal, rate, start, grace_months, total_months) VALUES (?, ?, ?, ?, ?, ?, ?)`,
				l.AccountID, l.Name, l.Principal, l.Rate, l.Start, l.GraceMonths, l.TotalMonths)
			if fail(c, err) {
				return
			}
			if l.ID, err = res.LastInsertId(); fail(c, err) {
				return
			}
		}
		c.JSON(http.StatusCreated, l)
	}
	r.POST("/api/loans", saveLoan)
	r.PUT("/api/loans/:id", saveLoan)
	r.DELETE("/api/loans/:id", func(c *gin.Context) {
		res, err := db.ExecContext(c.Request.Context(), `DELETE FROM loans WHERE id=?`, c.Param("id"))
		noContentOr404(c, res, err, "找不到這筆貸款")
	})

	r.GET("/api/export.csv", func(c *gin.Context) {
		// ?layout=long is the date,account,amount,fx layout POST /api/import reads back; ?lang=en labels the wide one in English.
		var b []byte
		var err error
		name := "wealth"
		if c.Query("layout") == "long" {
			b, err = exportLong(c.Request.Context(), db)
			name = "wealth-balances"
		} else {
			b, err = exportCSV(c.Request.Context(), db, c.Query("lang") == "en")
		}
		if fail(c, err) {
			return
		}
		c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s-%s.csv"`, name, time.Now().Format("2006-01-02")))
		c.Data(http.StatusOK, "text/csv; charset=utf-8", b)
	})

	r.GET("/api/fx", func(c *gin.Context) {
		set, err := settings(c.Request.Context(), db)
		if fail(c, err) {
			return
		}
		rate, err := fetchFX(c.Request.Context(), c.Query("cur"), set["base_currency"], c.Query("date"))
		if err != nil {
			slog.Warn("fx lookup failed", "err", err)
			bad(c, http.StatusBadGateway, "查不到 {} 在 {} 的匯率", c.Query("cur"), c.Query("date"))
			return
		}
		c.JSON(http.StatusOK, gin.H{"rate": rate})
	})

	return r
}

// bad sends a 4xx {error} in Chinese. With params, key (the message with {} holes, the same form as the UI's
// T“ strings) and params come along so the UI can translate messages that carry numbers or names.
// A []string param is a list: the Chinese message joins it with 、, the UI with its own separator.
func bad(c *gin.Context, status int, key string, params ...any) {
	// one pass over the template, so a value that itself contains {} isn't filled in turn
	parts := strings.Split(key, "{}")
	var b strings.Builder
	for i, part := range parts {
		b.WriteString(part)
		if i < len(parts)-1 && i < len(params) {
			s := fmt.Sprint(params[i])
			if list, ok := params[i].([]string); ok {
				s = strings.Join(list, "、")
			}
			b.WriteString(s)
		} else if i < len(parts)-1 {
			b.WriteString("{}")
		}
	}
	msg := b.String()
	body := gin.H{"error": msg}
	if len(params) > 0 {
		body["key"], body["params"] = key, params
	}
	c.AbortWithStatusJSON(status, body)
}

// guardWrites blocks cross-site writes (CSRF) and sets basic security headers. Mutating /api requests must
// carry a JSON (or, for the import, CSV) body type, which a plain HTML form can't send without a CORS preflight,
// and any Origin they carry must be this host. Behind a reverse proxy that rewrites Host (nginx's default
// proxy_pass), X-Forwarded-Host names the public host instead; a cross-site page can't set that header
// on a fetch without a CORS preflight, which this server never grants.
func guardWrites(c *gin.Context) {
	h := c.Writer.Header()
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "frame-ancestors 'none'")
	h.Set("Referrer-Policy", "same-origin")
	m, p := c.Request.Method, c.Request.URL.Path
	if m == http.MethodGet || m == http.MethodHead || m == http.MethodOptions || !strings.HasPrefix(p, "/api/") {
		return
	}
	if o := c.GetHeader("Origin"); o != "" {
		host := c.Request.Host
		if fh := c.GetHeader("X-Forwarded-Host"); fh != "" {
			host = strings.TrimSpace(strings.Split(fh, ",")[0])
		}
		if u, err := url.Parse(o); err != nil || u.Host != host {
			bad(c, http.StatusForbidden, "不接受其他網站送來的請求(Origin {} 和 Host {} 不同;用反向代理的話,請轉送原本的 Host 標頭)", o, host)
			return
		}
	}
	if m == http.MethodDelete {
		return
	}
	ct, _, _ := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if ct != "application/json" && !(ct == "text/csv" && p == "/api/import") {
		bad(c, http.StatusUnsupportedMediaType, "格式不正確")
	}
}

// setOrder sets sort = position for each key in one CASE statement per 40 keys. D1 caps a statement at
// 100 bound parameters; each key binds twice (WHEN and IN, the position is inlined as an int).
func setOrder(ctx context.Context, db *sql.DB, table, col string, keys []any) error {
	for i := 0; i < len(keys); i += 40 {
		chunk := keys[i:min(i+40, len(keys))]
		var q strings.Builder
		fmt.Fprintf(&q, `UPDATE %s SET sort = CASE %s`, table, col)
		for j := range chunk {
			fmt.Fprintf(&q, " WHEN ? THEN %d", i+j)
		}
		fmt.Fprintf(&q, ` END WHERE %s IN (%s)`, col, strings.TrimSuffix(strings.Repeat("?,", len(chunk)), ","))
		if _, err := db.ExecContext(ctx, q.String(), append(append([]any{}, chunk...), chunk...)...); err != nil {
			return err
		}
	}
	return nil
}

func accountExists(ctx context.Context, db *sql.DB, id string) (bool, error) {
	var n int
	err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM accounts WHERE id=?`, id).Scan(&n)
	return n > 0, err
}

// accountCurrencies maps every account id to its currency.
func accountCurrencies(ctx context.Context, db *sql.DB) (map[int64]string, error) {
	cur := map[int64]string{}
	err := queryEach(ctx, db, `SELECT id, currency FROM accounts`, func(r *sql.Rows) error {
		var id int64
		var c string
		err := r.Scan(&id, &c)
		cur[id] = c
		return err
	})
	return cur, err
}

// notFound answers 404 when an UPDATE or DELETE matched no row.
func notFound(c *gin.Context, res sql.Result, msg string) bool {
	n, err := res.RowsAffected()
	if fail(c, err) {
		return true
	}
	if n == 0 {
		bad(c, http.StatusNotFound, msg)
		return true
	}
	return false
}

func noContentOr404(c *gin.Context, res sql.Result, err error, msg string) {
	if fail(c, err) || notFound(c, res, msg) {
		return
	}
	c.Status(http.StatusNoContent)
}

func fail(c *gin.Context, err error) bool {
	if err != nil {
		slog.Error("request failed", "method", c.Request.Method, "path", c.Request.URL.Path, "err", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "伺服器錯誤"})
		return true
	}
	return false
}

// queryEach runs q and calls scan per row, closing rows before returning so the next query can reuse the connection.
func queryEach(ctx context.Context, db *sql.DB, q string, scan func(*sql.Rows) error) error {
	rows, err := db.QueryContext(ctx, q)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		if err := scan(rows); err != nil {
			return err
		}
	}
	return rows.Err()
}
