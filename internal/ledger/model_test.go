package ledger

import "testing"

func TestSeriesCarriesForward(t *testing.T) {
	kindOf := map[int64]string{1: "bank", 2: "us_stock", 3: "liability"}
	rows := series([]Snapshot{
		{1, "2026-01-01", 100, 1},
		{2, "2026-01-01", 10, 30}, // USD 10 @ 30
		{1, "2026-02-01", 150, 1}, // only bank updated; stock must carry forward
		{3, "2026-03-01", 50, 1},  // loan subtracts
	}, kindOf)
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
