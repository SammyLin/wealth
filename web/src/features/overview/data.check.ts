// Self-check, not bundled: `node src/features/overview/data.check.ts` (Node ≥ 23 strips the types).
import { inPeriod, liquidityMix, movers, usefulPeriods } from "./data.ts"
import type { Kind, Row } from "../../api/types.ts"

const eq = (got: unknown, want: unknown) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}
const row = (date: string, total = 0, by_kind: Record<string, number> = {}): Row => ({ date, total, by_kind })
const rows = [row("2020-01-01"), row("2023-06-01"), row("2025-09-01"), row("2026-01-01"), row("2026-10-01")]

eq(inPeriod(rows, "all").length, 5)
eq(inPeriod(rows, "1Y").map((r) => r.date), ["2025-09-01", "2026-01-01", "2026-10-01"]) // one before the window
eq(inPeriod(rows, "3Y").map((r) => r.date), ["2023-06-01", "2025-09-01", "2026-01-01", "2026-10-01"])
eq(inPeriod([row("2026-10-01")], "1Y").length, 1)
eq(inPeriod([], "1Y").length, 0)
eq(inPeriod(rows, "3M").map((r) => r.date), ["2026-01-01", "2026-10-01"])
eq(usefulPeriods(rows), ["3M", "1Y", "3Y", "all"]) // 6M = same rows as 3M; 5Y keeps the 2020 row as its left edge = same as all
eq(usefulPeriods(rows.slice(2)), ["3M", "all"])
eq(usefulPeriods(rows.slice(3)), ["all"])
eq(usefulPeriods([]), ["all"])

const kinds: Kind[] = [
  { key: "bank", name: "銀行", color: "#111111", liquidity: "liquid", sort: 0 },
  { key: "tw", name: "台股", color: "#222222", liquidity: "invest", sort: 1 },
  { key: "us", name: "美股", color: "#333333", liquidity: "invest", sort: 2 },
  { key: "home", name: "不動產", color: "#444444", liquidity: "fixed", sort: 3 },
  { key: "loan", name: "房貸", color: "#555555", liquidity: "liability", sort: 4 },
]
const m = liquidityMix(row("2026-10-01", 0, { bank: 100, tw: 50, us: 80, loan: -60, gone: 999 }), kinds)
eq(m.tiers, [
  { tier: "liquid", value: 100, color: "#111111" },
  { tier: "invest", value: 130, color: "#333333" }, // biggest kind's color
])
eq([m.assets, m.debt], [230, 60])
eq(liquidityMix(undefined, kinds), { tiers: [], assets: 0, debt: 0 })
eq(
  movers(row("2026-09-01", 0, { bank: 100, tw: 50, loan: -80 }), row("2026-10-01", 0, { bank: 90, tw: 80, loan: -60 }), kinds).map((x) => [x.kind.key, x.delta]),
  [["tw", 30], ["loan", 20], ["bank", -10]], // paying down the loan counts as +20
)
console.log("ok")
