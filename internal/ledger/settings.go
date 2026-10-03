package ledger

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// putSettings is PUT /api/settings: a partial update; unknown keys are ignored, every value is checked first.
func (h *api) putSettings(c *gin.Context) {
	var in map[string]string
	if !bindJSON(c, &in) {
		return
	}
	ctx := c.Request.Context()
	clean := map[string]string{}
	for k, v := range in {
		if _, ok := defaultSettings[k]; !ok {
			continue
		}
		v = strings.TrimSpace(v)
		switch k {
		case "base_currency":
			if !validCurrency(v) {
				bad(c, http.StatusBadRequest, "基準幣別要是三個英文字母,例如 TWD、USD")
				return
			}
			v = strings.ToUpper(v)
			cur, err := settings(ctx, h.db)
			if fail(c, err) {
				return
			}
			// every stored fx is "to the base currency", so the base can only change before any balance is recorded
			var n int
			if err := h.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM snapshots`).Scan(&n); fail(c, err) {
				return
			}
			if v != cur["base_currency"] && n > 0 {
				bad(c, http.StatusConflict, "已經有餘額紀錄,基準幣別不能再改(舊匯率都是對原本的幣別)")
				return
			}
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
				bad(c, http.StatusBadRequest, "單位要是 wan、k 或 full")
				return
			}
		case "layout":
			if len(v) > maxLayoutBytes || !validLayout(v) {
				bad(c, http.StatusBadRequest, "版面設定要是 4 KB 以內的 JSON,區塊只能是 trend、mix、sheet、loans、events,各一次")
				return
			}
		case "demo", "stale_muted":
			if v != "" && (len(v) > maxLayoutBytes || !validIDs(v, k == "demo")) {
				bad(c, http.StatusBadRequest, "格式不正確")
				return
			}
		default:
			if len([]rune(v)) > 60 {
				bad(c, http.StatusBadRequest, "文字太長")
				return
			}
		}
		clean[k] = v
	}
	for k, v := range clean {
		if _, err := h.db.ExecContext(ctx, `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, k, v); fail(c, err) {
			return
		}
	}
	c.Status(http.StatusNoContent)
}

// validLayout: {"sections":[{"id","hidden"}]} with known section ids, none twice (the UI fills in any left out).
func validLayout(v string) bool {
	var l struct {
		Sections []struct {
			ID     string `json:"id"`
			Hidden bool   `json:"hidden"`
		} `json:"sections"`
	}
	if json.Unmarshal([]byte(v), &l) != nil {
		return false
	}
	seen := map[string]bool{}
	for _, s := range l.Sections {
		switch s.ID {
		case "trend", "mix", "sheet", "loans", "events":
		default:
			return false
		}
		if seen[s.ID] {
			return false
		}
		seen[s.ID] = true
	}
	return true
}

// validIDs: a JSON list of ids ([1,2]), or with obj an object of such lists keyed accounts / loans / events.
func validIDs(v string, obj bool) bool {
	if !obj {
		var ids []int64
		return json.Unmarshal([]byte(v), &ids) == nil
	}
	var m map[string][]int64
	if json.Unmarshal([]byte(v), &m) != nil {
		return false
	}
	for k := range m {
		if k != "accounts" && k != "loans" && k != "events" {
			return false
		}
	}
	return true
}
