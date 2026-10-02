package ledger

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// FXClient is replaced on Workers, where outbound requests must go through fetch().
var FXClient = &http.Client{Timeout: 8 * time.Second}

// fetchFX returns how many units of base one unit of cur was worth on date (YYYY-MM-DD; today or later = latest).
// Source: fawazahmed0/currency-api (free, no key, daily history from 2024-03).
func fetchFX(cur, base, date string) (float64, error) {
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
		res, err := FXClient.Get(u)
		if err != nil {
			lastErr = err
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
