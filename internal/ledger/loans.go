package ledger

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// saveLoan is POST /api/loans and PUT /api/loans/:id (a Loan without id). account_id, when set, must exist.
func (h *api) saveLoan(c *gin.Context) {
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
		if found, err := accountExists(c.Request.Context(), h.db, strconv.FormatInt(*l.AccountID, 10)); fail(c, err) {
			return
		} else if !found {
			bad(c, http.StatusBadRequest, "找不到這個帳戶")
			return
		}
	}
	l.Name = strings.TrimSpace(l.Name)
	h.saveRow(c, "loans", "找不到這筆貸款",
		[]string{"account_id", "name", "principal", "rate", "start", "grace_months", "total_months"},
		[]any{l.AccountID, l.Name, l.Principal, l.Rate, l.Start, l.GraceMonths, l.TotalMonths}, &l.ID, &l)
}
