package ledger

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// fx is GET /api/fx?cur=&date=: the rate that converts 1 cur into the base currency on date.
func (h *api) fx(c *gin.Context) {
	set, err := settings(c.Request.Context(), h.db)
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
}

// FXClient is replaced on Workers, where outbound requests must go through fetch().
var FXClient = &http.Client{Timeout: 8 * time.Second}

// fetchFX returns how many units of base one unit of cur was worth on date (YYYY-MM-DD; today or later = latest).
// Source: fawazahmed0/currency-api (free, no key, daily history from 2024-03).
func fetchFX(ctx context.Context, cur, base, date string) (float64, error) {
	cur, base = strings.ToLower(cur), strings.ToLower(base)
	if !validCurrency(cur) || !validCurrency(base) {
		return 0, fmt.Errorf("bad currency")
	}
	if !validDate(date) || date >= time.Now().Format("2006-01-02") {
		date = "latest"
	}
	var lastErr error
	for _, u := range []string{
		"https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@" + date + "/v1/currencies/" + cur + ".json",
		"https://" + date + ".currency-api.pages.dev/v1/currencies/" + cur + ".json",
	} {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
		if err != nil {
			return 0, fmt.Errorf("fx request: %w", err)
		}
		res, err := FXClient.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("fx fetch: %w", err)
			continue
		}
		if res.StatusCode != http.StatusOK {
			res.Body.Close()
			lastErr = fmt.Errorf("fx fetch %s: status %d", u, res.StatusCode)
			continue
		}
		var body map[string]json.RawMessage
		err = json.NewDecoder(res.Body).Decode(&body)
		res.Body.Close()
		var rates map[string]float64
		if err == nil {
			err = json.Unmarshal(body[cur], &rates)
		}
		if err == nil && rates[base] > 0 {
			return rates[base], nil
		}
		lastErr = fmt.Errorf("no rate for %s/%s on %s", cur, base, date)
	}
	return 0, lastErr
}
