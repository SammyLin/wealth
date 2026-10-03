package ledger

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// saveEvent is POST /api/events and PUT /api/events/:id {date,title}.
func (h *api) saveEvent(c *gin.Context) {
	var e Event
	if c.ShouldBindJSON(&e) != nil || strings.TrimSpace(e.Title) == "" {
		bad(c, http.StatusBadRequest, "日期和事件名稱必填")
		return
	}
	if outOfRange(e.Date) {
		bad(c, http.StatusBadRequest, "日期要在 1900–2199 年之間")
		return
	}
	if !validDate(e.Date) {
		bad(c, http.StatusBadRequest, "日期和事件名稱必填")
		return
	}
	e.Title = strings.TrimSpace(e.Title)
	if len([]rune(e.Title)) > maxName {
		bad(c, http.StatusBadRequest, "文字太長")
		return
	}
	h.saveRow(c, "events", "找不到這件大事", []string{"date", "title"}, []any{e.Date, e.Title}, &e.ID, &e)
}
