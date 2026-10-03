package ledger

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// saveLoan is POST /api/loans and PUT /api/loans/:id (a Loan without id). account_id, when set, must be a liability account.
func (h *api) saveLoan(c *gin.Context) {
	var l Loan
	if !bindJSON(c, &l) {
		return
	}
	if msg := validLoan(l); msg != "" {
		bad(c, http.StatusBadRequest, msg)
		return
	}
	if l.AccountID != nil {
		var liq string
		err := h.db.QueryRowContext(c.Request.Context(),
			`SELECT k.liquidity FROM accounts a JOIN account_kinds k ON k.key=a.kind WHERE a.id=?`, *l.AccountID).Scan(&liq)
		if errors.Is(err, sql.ErrNoRows) {
			bad(c, http.StatusBadRequest, "找不到這個帳戶")
			return
		} else if fail(c, err) {
			return
		} else if liq != "liability" {
			bad(c, http.StatusBadRequest, "貸款只能連結到負債類別的帳戶")
			return
		}
	}
	l.Name = strings.TrimSpace(l.Name)
	h.saveRow(c, "loans", "找不到這筆貸款",
		[]string{"account_id", "name", "principal", "rate", "start", "grace_months", "total_months"},
		[]any{l.AccountID, l.Name, l.Principal, l.Rate, l.Start, l.GraceMonths, l.TotalMonths}, &l.ID, &l)
}
