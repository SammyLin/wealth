package ledger

import (
	"context"
	"database/sql"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// Guards that ride along in the INSERT/UPDATE itself (D1 has no transactions), so a kind deleted a moment
// earlier or a double-submitted form can't slip in between a check and the write.
const (
	kindExistsSQL = `EXISTS (SELECT 1 FROM account_kinds WHERE key=?)`
	// names are unique ignoring ASCII case: the import and the UI find accounts by name
	nameFreeSQL = `NOT EXISTS (SELECT 1 FROM accounts WHERE lower(name)=lower(?) AND id<>?)`
)

// createAccount is POST /api/accounts {name,kind,currency?,note?}. New accounts go last; PUT /api/accounts/order moves them.
func (h *api) createAccount(c *gin.Context) {
	var a Account
	if c.ShouldBindJSON(&a) != nil || strings.TrimSpace(a.Name) == "" {
		bad(c, http.StatusBadRequest, "名稱和類別必填")
		return
	}
	ctx := c.Request.Context()
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
		set, err := settings(ctx, h.db)
		if fail(c, err) {
			return
		}
		a.Currency = set["base_currency"]
	}
	if !validCurrency(a.Currency) {
		bad(c, http.StatusBadRequest, "幣別要是三個英文字母")
		return
	}
	a.Currency = strings.ToUpper(a.Currency)
	ok, err := insertAccount(ctx, h.db, &a)
	if fail(c, err) {
		return
	}
	if !ok {
		h.rejectAccount(c, &a.Kind, &a.Name, 0)
		return
	}
	c.JSON(http.StatusCreated, a)
}

// insertAccount adds a (already validated) at the end of the list. false = the guard matched nothing: the
// kind is gone or the name is taken (rejectAccount says which). Shared by POST /api/accounts and the import.
func insertAccount(ctx context.Context, db *sql.DB, a *Account) (bool, error) {
	if err := db.QueryRowContext(ctx, `SELECT COALESCE(MAX(sort), -1) + 1 FROM accounts`).Scan(&a.Sort); err != nil {
		return false, err
	}
	a.Archived, a.FX, a.History = false, 1, []Point{}
	res, err := db.ExecContext(ctx, `INSERT INTO accounts (name, kind, currency, sort, note) SELECT ?, ?, ?, ?, ? WHERE `+kindExistsSQL+` AND `+nameFreeSQL,
		a.Name, a.Kind, a.Currency, a.Sort, a.Note, a.Kind, a.Name, 0)
	if err != nil {
		return false, err
	}
	if n, err := res.RowsAffected(); err != nil || n == 0 {
		return false, err
	}
	a.ID, err = res.LastInsertId()
	return err == nil, err
}

// patchAccount edits name / kind / currency / archived / sort / note. Archive instead of delete: history stays
// in the trend. Everything is validated before the single UPDATE, so a bad field changes nothing.
func (h *api) patchAccount(c *gin.Context) {
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
	if found, err := accountExists(ctx, h.db, id); fail(c, err) {
		return
	} else if !found {
		bad(c, http.StatusNotFound, "找不到這個帳戶")
		return
	}
	var sets, guards []string
	var args, guardArgs []any
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
		body.Name = &name
		guards, guardArgs = append(guards, nameFreeSQL), append(guardArgs, name, id)
	}
	if body.Kind != nil {
		set("kind", *body.Kind)
		guards, guardArgs = append(guards, kindExistsSQL), append(guardArgs, *body.Kind)
	}
	if body.Currency != nil {
		if !validCurrency(*body.Currency) {
			bad(c, http.StatusBadRequest, "幣別要是三個英文字母")
			return
		}
		var snaps int
		if err := h.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM snapshots WHERE account_id=?`, id).Scan(&snaps); fail(c, err) {
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
		if *body.Sort < -maxSort || *body.Sort > maxSort {
			bad(c, http.StatusBadRequest, "排序值超出範圍")
			return
		}
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
		q := `UPDATE accounts SET ` + strings.Join(sets, ", ") + ` WHERE ` + strings.Join(append([]string{"id=?"}, guards...), " AND ")
		res, err := h.db.ExecContext(ctx, q, append(append(args, id), guardArgs...)...)
		if fail(c, err) {
			return
		}
		if n, err := res.RowsAffected(); fail(c, err) {
			return
		} else if n == 0 {
			h.rejectAccount(c, body.Kind, body.Name, id)
			return
		}
	}
	c.Status(http.StatusNoContent)
}

// rejectAccount says why a guarded account INSERT/UPDATE matched nothing: the kind is gone, the name is taken,
// or (an UPDATE racing a DELETE) the account itself is gone.
func (h *api) rejectAccount(c *gin.Context, kind, name *string, id any) {
	ctx := c.Request.Context()
	if kind != nil {
		ok, err := kindExists(ctx, h.db, *kind)
		if fail(c, err) {
			return
		}
		if !ok {
			bad(c, http.StatusBadRequest, "類別不正確")
			return
		}
	}
	if name != nil {
		var n int
		if err := h.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM accounts WHERE lower(name)=lower(?) AND id<>?`, *name, id).Scan(&n); fail(c, err) {
			return
		}
		if n > 0 {
			bad(c, http.StatusConflict, "已經有同名的帳戶:{}", *name)
			return
		}
	}
	bad(c, http.StatusNotFound, "找不到這個帳戶")
}

// orderAccounts is PUT /api/accounts/order {ids}: sort = position in ids (see setOrder for the D1 chunking).
func (h *api) orderAccounts(c *gin.Context) {
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
	if fail(c, setOrder(c.Request.Context(), h.db, "accounts", "id", keys)) {
		return
	}
	c.Status(http.StatusNoContent)
}

// deleteAccount removes an account and its whole history (for mistakes or accounts that shouldn't be counted).
// Loans that pointed at it stay, unlinked. No transactions on D1, so the order keeps it consistent.
func (h *api) deleteAccount(c *gin.Context) {
	id := c.Param("id")
	if found, err := accountExists(c.Request.Context(), h.db, id); fail(c, err) {
		return
	} else if !found {
		bad(c, http.StatusNotFound, "找不到這個帳戶")
		return
	}
	for _, q := range []string{`DELETE FROM snapshots WHERE account_id=?`, `UPDATE loans SET account_id=NULL WHERE account_id=?`, `DELETE FROM accounts WHERE id=?`} {
		if _, err := h.db.ExecContext(c.Request.Context(), q, id); fail(c, err) {
			return
		}
	}
	c.Status(http.StatusNoContent)
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
