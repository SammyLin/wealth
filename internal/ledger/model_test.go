package ledger

import "testing"

var testKinds = map[string]Kind{
	"bank":      {Key: "bank", Liquidity: "liquid"},
	"us_stock":  {Key: "us_stock", Liquidity: "invest"},
	"liability": {Key: "liability", Liquidity: "liability"},
}

func TestSeriesCarriesForward(t *testing.T) {
	kindOf := map[int64]string{1: "bank", 2: "us_stock", 3: "liability"}
	rows := series([]Snapshot{
		{1, "2026-01-01", 100, 1},
		{2, "2026-01-01", 10, 30}, // USD 10 @ 30
		{1, "2026-02-01", 150, 1}, // only bank updated; stock must carry forward
		{3, "2026-03-01", 50, 1},  // loan subtracts
	}, kindOf, testKinds)
	want := []float64{400, 450, 400}
	if len(rows) != len(want) {
		t.Fatalf("got %d rows", len(rows))
	}
	for i, w := range want {
		if rows[i].Total != w {
			t.Errorf("row %d total %v want %v", i, rows[i].Total, w)
		}
	}
	if rows[1].ByKind["us_stock"] != 300 {
		t.Errorf("us_stock not carried: %v", rows[1].ByKind)
	}
}

// The sign follows the kind's liquidity, not the key "liability": a user-defined kind can be a debt.
func TestSeriesSignFromLiquidity(t *testing.T) {
	kinds := map[string]Kind{"bank": {Liquidity: "liquid"}, "card": {Liquidity: "liability"}, "liability": {Liquidity: "fixed"}}
	kindOf := map[int64]string{1: "bank", 2: "card", 3: "liability"}
	rows := series([]Snapshot{{1, "2026-01-01", 100, 1}, {2, "2026-01-01", 30, 1}, {3, "2026-01-01", 10, 1}}, kindOf, kinds)
	if len(rows) != 1 || rows[0].Total != 80 || rows[0].ByKind["card"] != -30 || rows[0].ByKind["liability"] != 10 {
		t.Fatalf("got %+v", rows)
	}
}
