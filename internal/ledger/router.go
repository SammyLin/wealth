package ledger

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

const (
	maxNote = 200
	maxName = 60        // account names, in runes
	maxSort = 1_000_000 // |sort|, so MAX(sort)+1 for a new account can never overflow
	maxBody = 1 << 20   // every write body (JSON or the import CSV)
	// A Worker request is capped at a few dozen subrequests on the free plan; each 20 rows is one D1 statement,
	// so a batch of balances (snapshots or the CSV import) is capped instead of risking a half-applied write.
	maxBatchRows = 1000
)

// api holds the handlers; each resource's routes live in their own file (accounts.go, kinds.go, ...).
type api struct{ db *sql.DB }

// New holds every page and API route. cmd/wealth's server.go (local SQLite) and worker.go
// (Cloudflare Workers + D1) only differ in how they open db and serve the router.
// fileBackups tells the UI a .db download and daily backups exist (self-hosted only;
// on Workers, D1 Time Travel covers backups instead).
func New(db *sql.DB, fileBackups bool, middleware ...gin.HandlerFunc) *gin.Engine {
	r := gin.New()
	r.Use(append([]gin.HandlerFunc{gin.Recovery(), guardWrites}, middleware...)...)
	serveSPA(r)
	h := &api{db}

	// Answers "ok <version>". For a container healthcheck (server.go lets it past basic auth); HEAD too, for uptime monitors.
	health := func(c *gin.Context) {
		if err := db.PingContext(c.Request.Context()); err != nil {
			c.String(http.StatusServiceUnavailable, "db unavailable")
			return
		}
		c.String(http.StatusOK, "ok "+Version)
	}
	r.GET("/healthz", health)
	r.HEAD("/healthz", health)

	r.GET("/api/state", h.state(fileBackups))
	r.PUT("/api/settings", h.putSettings)

	r.POST("/api/accounts", h.createAccount)
	r.PATCH("/api/accounts/:id", h.patchAccount)
	r.PUT("/api/accounts/order", h.orderAccounts)
	r.DELETE("/api/accounts/:id", h.deleteAccount)

	r.POST("/api/snapshots", h.putSnapshots)
	r.DELETE("/api/snapshots", h.deleteSnapshot)
	r.POST("/api/import", h.importBalances)

	r.POST("/api/kinds", h.createKind)
	r.PUT("/api/kinds/order", h.orderKinds)
	r.PUT("/api/kinds/:key", h.updateKind)
	r.DELETE("/api/kinds/:key", h.deleteKind)

	r.POST("/api/events", h.saveEvent)
	r.PUT("/api/events/:id", h.saveEvent)
	r.DELETE("/api/events/:id", h.deleteByID("events", "找不到這件大事"))

	r.POST("/api/loans", h.saveLoan)
	r.PUT("/api/loans/:id", h.saveLoan)
	r.DELETE("/api/loans/:id", h.deleteByID("loans", "找不到這筆貸款"))

	r.GET("/api/export.csv", h.export)
	r.GET("/api/fx", h.fx)
	return r
}

// saveRow is the create-or-update behind POST /api/<table> and PUT /api/<table>/:id: cols are filled from args
// in order; an insert answers 201, an update 200 (404 when no row has that id). *id receives the row's id
// before out (which holds it) is sent back.
func (h *api) saveRow(c *gin.Context, table, missing string, cols []string, args []any, id *int64, out any) {
	ctx := c.Request.Context()
	if p := c.Param("id"); p != "" {
		n, err := strconv.ParseInt(p, 10, 64)
		if err != nil {
			bad(c, http.StatusBadRequest, "id 不正確")
			return
		}
		res, err := h.db.ExecContext(ctx, `UPDATE `+table+` SET `+strings.Join(cols, "=?, ")+`=? WHERE id=?`, append(args, n)...)
		if fail(c, err) || notFound(c, res, missing) {
			return
		}
		*id = n
		c.JSON(http.StatusOK, out)
		return
	}
	res, err := h.db.ExecContext(ctx, `INSERT INTO `+table+` (`+strings.Join(cols, ", ")+`) VALUES (`+placeholders(len(cols))+`)`, args...)
	if fail(c, err) {
		return
	}
	if *id, err = res.LastInsertId(); fail(c, err) {
		return
	}
	c.JSON(http.StatusCreated, out)
}

// deleteByID is DELETE /api/<table>/:id.
func (h *api) deleteByID(table, missing string) gin.HandlerFunc {
	return func(c *gin.Context) {
		res, err := h.db.ExecContext(c.Request.Context(), `DELETE FROM `+table+` WHERE id=?`, c.Param("id"))
		noContentOr404(c, res, err, missing)
	}
}

func placeholders(n int) string { return strings.TrimSuffix(strings.Repeat("?, ", n), ", ") }

// bad sends a 4xx {error} in Chinese. With params, key (the message with {} holes, the same form as the UI's
// T“ strings) and params come along so the UI can translate messages that carry numbers or names.
// A []string param is a list: the Chinese message joins it with 、, the UI with its own separator.
func bad(c *gin.Context, status int, key string, params ...any) {
	c.AbortWithStatusJSON(status, (&userErr{key, params}).body())
}

// userErr is a 400 message for bad(): a Chinese template with {} holes plus its values.
type userErr struct {
	key    string
	params []any
}

func errf(key string, params ...any) *userErr { return &userErr{key, params} }

// body is the JSON bad() sends: {error} filled in, plus key and params when there are values.
func (e *userErr) body() gin.H {
	// one pass over the template, so a value that itself contains {} isn't filled in turn
	parts := strings.Split(e.key, "{}")
	var b strings.Builder
	for i, part := range parts {
		b.WriteString(part)
		if i < len(parts)-1 && i < len(e.params) {
			s := fmt.Sprint(e.params[i])
			if list, ok := e.params[i].([]string); ok {
				s = strings.Join(list, "、")
			}
			b.WriteString(s)
		} else if i < len(parts)-1 {
			b.WriteString("{}")
		}
	}
	body := gin.H{"error": b.String()}
	if len(e.params) > 0 {
		body["key"], body["params"] = e.key, e.params
	}
	return body
}

// SystemFonts (WEALTH_FONTS=system on the self-hosted server) drops the two web-font hosts: index.html is served
// with data-fonts="system" so boot.js skips them, and the CSP stops allowing them. For air-gapped or LAN-only installs.
var SystemFonts bool

// csp: scripts only from this origin (web/public/boot.js replaced the inline boot script and the fonts'
// onload swap), styles inline too (Mantine injects <style> tags), fonts from the two font hosts unless SystemFonts.
func csp() string {
	style, font := " https://fonts.googleapis.com https://font.emtech.cc", " https://fonts.gstatic.com https://font.emtech.cc"
	if SystemFonts {
		style, font = "", ""
	}
	// Cloudflare's Web Analytics (when enabled on the zone) injects its beacon into every page; allow it.
	return "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'" + style + "; " +
		"font-src 'self' data:" + font + "; img-src 'self' data:; connect-src 'self' https://cloudflareinsights.com; " +
		"object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
}

// guardWrites blocks cross-site writes (CSRF), caps write bodies and sets basic security headers. Mutating
// /api requests must carry a JSON (or, for the import, CSV) body type, which a plain HTML form can't send
// without a CORS preflight, and any Origin they carry must be this host. Behind a reverse proxy that rewrites
// Host (nginx's default proxy_pass), X-Forwarded-Host names the public host instead; a cross-site page can't
// set that header on a fetch without a CORS preflight, which this server never grants.
func guardWrites(c *gin.Context) {
	h := c.Writer.Header()
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", csp())
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
		return
	}
	// a body past the cap fails to read (bind → 400) instead of filling memory or one giant D1 batch
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBody)
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
		fmt.Fprintf(&q, ` END WHERE %s IN (%s)`, col, placeholders(len(chunk)))
		if _, err := db.ExecContext(ctx, q.String(), append(append([]any{}, chunk...), chunk...)...); err != nil {
			return err
		}
	}
	return nil
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

// bindJSON decodes the body into v, or answers 400 and returns false. A body past maxBody gets its own message
// instead of whatever the handler would say about a missing field.
// Version is stamped at build time: -ldflags "-X github.com/SammyLin/wealth/internal/ledger.Version=v2.0.0".
var Version = "dev"

func bindJSON(c *gin.Context, v any) bool {
	err := c.ShouldBindJSON(v)
	if mb := (*http.MaxBytesError)(nil); errors.As(err, &mb) {
		bad(c, http.StatusBadRequest, "內容超過 1 MB")
	} else if err != nil {
		bad(c, http.StatusBadRequest, "格式不正確")
	}
	return err == nil
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
func queryEach(ctx context.Context, db *sql.DB, q string, scan func(*sql.Rows) error, args ...any) error {
	rows, err := db.QueryContext(ctx, q, args...)
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
