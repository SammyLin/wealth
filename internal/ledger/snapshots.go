package ledger

import (
	"context"
	"database/sql"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// putSnapshots is POST /api/snapshots: one form submits every account's balance for a date, upserted.
func (h *api) putSnapshots(c *gin.Context) {
	var in []Snapshot
	if !bindJSON(c, &in) {
		return
	}
	if len(in) > maxBatchRows {
		bad(c, http.StatusBadRequest, "一次最多匯入 {} 筆,請分批", maxBatchRows)
		return
	}
	for _, s := range in {
		if !validDate(s.Date) {
			bad(c, http.StatusBadRequest, "日期格式要是 YYYY-MM-DD,年份 1900–2199")
			return
		}
		if futureDate(s.Date) {
			bad(c, http.StatusBadRequest, "日期不能在未來")
			return
		}
		if !validSnapshot(s) {
			bad(c, http.StatusBadRequest, "日期、金額或匯率不正確")
			return
		}
	}
	ctx := c.Request.Context()
	curOf, err := accountCurrencies(ctx, h.db)
	if fail(c, err) {
		return
	}
	set, err := settings(ctx, h.db)
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
	if err := upsertSnapshots(ctx, h.db, in); fail(c, err) {
		return
	}
	c.Status(http.StatusNoContent)
}

// deleteSnapshot is DELETE /api/snapshots?account_id=&date=.
func (h *api) deleteSnapshot(c *gin.Context) {
	res, err := h.db.ExecContext(c.Request.Context(), `DELETE FROM snapshots WHERE account_id=? AND date=?`, c.Query("account_id"), c.Query("date"))
	noContentOr404(c, res, err, "找不到這筆紀錄")
}

// upsertSnapshots writes rows in multi-row statements of 20 (4 params each; D1 caps a statement at 100).
// No transaction on D1, but an upsert is idempotent, so retrying after a partial failure is safe.
func upsertSnapshots(ctx context.Context, db *sql.DB, in []Snapshot) error {
	for i := 0; i < len(in); i += 20 {
		chunk := in[i:min(i+20, len(in))]
		args := make([]any, 0, len(chunk)*4)
		for _, s := range chunk {
			args = append(args, s.AccountID, s.Date, s.Amount, s.FX)
		}
		q := `INSERT INTO snapshots (account_id, date, amount, fx) VALUES ` +
			strings.TrimSuffix(strings.Repeat("(?, ?, ?, ?),", len(chunk)), ",") +
			` ON CONFLICT(account_id, date) DO UPDATE SET amount=excluded.amount, fx=excluded.fx`
		if _, err := db.ExecContext(ctx, q, args...); err != nil {
			return err
		}
	}
	return nil
}
