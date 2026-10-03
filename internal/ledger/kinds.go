package ledger

import (
	"cmp"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// createKind is POST /api/kinds {key,name,color,liquidity,sort}: 409 when the key or the name is taken.
func (h *api) createKind(c *gin.Context) {
	var k Kind
	if !bindJSON(c, &k) {
		return
	}
	if !kindKeyRe.MatchString(k.Key) {
		bad(c, http.StatusBadRequest, "代號要是小寫英文開頭,2–32 個小寫英文、數字或底線")
		return
	}
	if msg := validKindFields(k); msg != "" {
		bad(c, http.StatusBadRequest, msg)
		return
	}
	ctx := c.Request.Context()
	k.Name, k.Color = strings.TrimSpace(k.Name), strings.ToLower(k.Color)
	// the uniqueness checks ride in the INSERT itself (D1 has no transactions), like the account guards
	names := nameAliases(k.Name)
	res, err := h.db.ExecContext(ctx, `INSERT INTO account_kinds (key, name, color, liquidity, sort) SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM account_kinds WHERE key=? OR `+nameInSQL(len(names))+`)`,
		append([]any{k.Key, k.Name, k.Color, k.Liquidity, k.Sort, k.Key}, names...)...)
	if fail(c, err) {
		return
	}
	if n, err := res.RowsAffected(); fail(c, err) {
		return
	} else if n == 0 {
		if exists, err := kindExists(ctx, h.db, k.Key); fail(c, err) {
			return
		} else if exists {
			bad(c, http.StatusConflict, "這個代號已經存在")
			return
		}
		bad(c, http.StatusConflict, "已經有同名的類別")
		return
	}
	c.JSON(http.StatusCreated, k)
}

// orderKinds is PUT /api/kinds/order {keys}: one request renumbers every kind (same chunked CASE as accounts).
func (h *api) orderKinds(c *gin.Context) {
	var in struct {
		Keys []string `json:"keys"`
	}
	if !bindJSON(c, &in) {
		return
	}
	if len(in.Keys) > 500 {
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
	if fail(c, setOrder(c.Request.Context(), h.db, "account_kinds", "key", keys)) {
		return
	}
	c.Status(http.StatusNoContent)
}

// updateKind is PUT /api/kinds/:key {name,color,liquidity,sort}. The key can't change: accounts point at it.
func (h *api) updateKind(c *gin.Context) {
	var k Kind
	if !bindJSON(c, &k) {
		return
	}
	k.Key = c.Param("key")
	if msg := validKindFields(k); msg != "" {
		bad(c, http.StatusBadRequest, msg)
		return
	}
	ctx := c.Request.Context()
	k.Name, k.Color = strings.TrimSpace(k.Name), strings.ToLower(k.Color)
	names := nameAliases(k.Name)
	res, err := h.db.ExecContext(ctx, `UPDATE account_kinds SET name=?, color=?, liquidity=?, sort=? WHERE key=? AND NOT EXISTS (SELECT 1 FROM account_kinds WHERE key<>? AND `+nameInSQL(len(names))+`)`,
		append([]any{k.Name, k.Color, k.Liquidity, k.Sort, k.Key, k.Key}, names...)...)
	if fail(c, err) {
		return
	}
	if n, err := res.RowsAffected(); fail(c, err) {
		return
	} else if n == 0 {
		if exists, err := kindExists(ctx, h.db, k.Key); fail(c, err) {
			return
		} else if !exists {
			bad(c, http.StatusNotFound, "找不到這個類別")
			return
		}
		bad(c, http.StatusConflict, "已經有同名的類別")
		return
	}
	c.JSON(http.StatusOK, k)
}

// deleteKind is DELETE /api/kinds/:key: 409 while any account still uses it.
func (h *api) deleteKind(c *gin.Context) {
	ctx, key := c.Request.Context(), c.Param("key")
	// the NOT EXISTS makes the check and the delete one statement, since D1 has no transactions
	res, err := h.db.ExecContext(ctx, `DELETE FROM account_kinds WHERE key=? AND NOT EXISTS (SELECT 1 FROM accounts WHERE kind=?)`, key, key)
	if fail(c, err) {
		return
	}
	if n, err := res.RowsAffected(); fail(c, err) {
		return
	} else if n > 0 {
		c.Status(http.StatusNoContent)
		return
	}
	var used int
	if err := h.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM accounts WHERE kind=?`, key).Scan(&used); fail(c, err) {
		return
	}
	if used > 0 {
		bad(c, http.StatusConflict, "還有 {} 個帳戶使用這個類別,請先改到別的類別", used)
		return
	}
	bad(c, http.StatusNotFound, "找不到這個類別")
}

// nameAliases is every stored name that would show as name in either UI language: the name itself plus the
// seeded kinds it translates to or from, so an English ledger can't get a second "Bank" next to 銀行.
func nameAliases(name string) []any {
	en := cmp.Or(seededKindEn[name], name)
	out := []any{name}
	if en != name {
		out = append(out, en)
	}
	for zh, e := range seededKindEn {
		if strings.EqualFold(e, en) && zh != name {
			out = append(out, zh)
		}
	}
	return out
}

func nameInSQL(n int) string {
	return "lower(name) IN (" + strings.TrimSuffix(strings.Repeat("lower(?),", n), ",") + ")"
}
