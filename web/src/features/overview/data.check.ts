// Self-check, not bundled: `node src/features/overview/data.check.ts` (Node 22.18+ strips the types); `npm run check` runs every *.check.ts with node --test.
import assert from "node:assert/strict"
import { inPeriod, inRange, liquidityMix, movers, niceTicks, openings, topAccount, usefulPeriods } from "./data.ts"
import type { Account, Kind, Row } from "../../api/types.ts"

const row = (date: string, total = 0, by_kind: Record<string, number> = {}): Row => ({ date, total, by_kind })
const rows = [row("2020-01-01"), row("2023-06-01"), row("2025-09-01"), row("2026-01-01"), row("2026-10-01")]

assert.deepStrictEqual(inPeriod(rows, "all").length, 5)
assert.deepStrictEqual(inPeriod(rows, "1Y").map((r) => r.date), ["2025-09-01", "2026-01-01", "2026-10-01"]) // one before the window
assert.deepStrictEqual(inPeriod(rows, "3Y").map((r) => r.date), ["2023-06-01", "2025-09-01", "2026-01-01", "2026-10-01"])
assert.deepStrictEqual(inPeriod([row("2026-10-01")], "1Y").length, 1)
assert.deepStrictEqual(inPeriod([], "1Y").length, 0)
assert.deepStrictEqual(inPeriod(rows, "3M").map((r) => r.date), ["2026-01-01", "2026-10-01"])
assert.deepStrictEqual(usefulPeriods(rows), ["3M", "1Y", "3Y", "all"]) // 6M = same rows as 3M; 5Y keeps the 2020 row as its left edge = same as all
assert.deepStrictEqual(usefulPeriods(rows.slice(2)), ["3M", "all"])
assert.deepStrictEqual(usefulPeriods(rows.slice(3)), ["all"])
assert.deepStrictEqual(usefulPeriods([]), ["all"])

const kinds: Kind[] = [
  { key: "bank", name: "銀行", color: "#111111", liquidity: "liquid", sort: 0 },
  { key: "tw", name: "台股", color: "#222222", liquidity: "invest", sort: 1 },
  { key: "us", name: "美股", color: "#333333", liquidity: "invest", sort: 2 },
  { key: "home", name: "不動產", color: "#444444", liquidity: "fixed", sort: 3 },
  { key: "loan", name: "房貸", color: "#555555", liquidity: "liability", sort: 4 },
]
const m = liquidityMix(row("2026-10-01", 0, { bank: 100, tw: 50, us: 80, loan: -60, gone: 999 }), kinds)
assert.deepStrictEqual(m.tiers, [
  { tier: "liquid", value: 100 },
  { tier: "invest", value: 130 },
])
assert.deepStrictEqual([m.assets, m.debt], [230, 60])
assert.deepStrictEqual(liquidityMix(undefined, kinds), { tiers: [], assets: 0, debt: 0 })
assert.deepStrictEqual(
  movers(row("2026-09-01", 0, { bank: 100, tw: 50, loan: -80 }), row("2026-10-01", 0, { bank: 90, tw: 80, loan: -60 }), kinds).map((x) => [x.kind.key, x.delta]),
  [["tw", 30], ["loan", 20], ["bank", -10]], // paying down the loan counts as +20
)
assert.deepStrictEqual(inRange(rows, "2025-01-01", "2026-06-30").map((r) => r.date), ["2023-06-01", "2025-09-01", "2026-01-01"])
assert.deepStrictEqual(inRange(rows, "2030-01-01", "2031-01-01").map((r) => r.date), ["2026-10-01"])
assert.deepStrictEqual(inRange(rows, "2025-09-01", "2026-01-01").map((r) => r.date), ["2025-09-01", "2026-01-01"]) // a record on `from` itself
// round ticks around the data, never the raw max (round 3: 1,025.2萬 / 1,014.4萬 / 999.4萬 …)
assert.deepStrictEqual(niceTicks(9_844_000, 10_252_000), [9_800_000, 9_900_000, 10_000_000, 10_100_000, 10_200_000, 10_300_000])
assert.deepStrictEqual(niceTicks(0, 1), [0, 0.2, 0.4, 0.6, 0.8, 1])
assert.deepStrictEqual(niceTicks(-323_600, -310_000), [-325_000, -320_000, -315_000, -310_000])
assert.deepStrictEqual(niceTicks(5, 5), [4.9, 4.95, 5, 5.05, 5.1])

// the account behind the move, balances carried forward: the mortgage paid down 30 beats the bank's −10
const acct = (id: number, kind: string, history: [string, number][]): Account => ({
  id, name: `a${id}`, kind, currency: "TWD", archived: false, sort: id, note: "", amount: 0, fx: 1,
  history: history.map(([date, value]) => ({ date, value, amount: value, fx: 1 })),
})
const accts = [acct(1, "bank", [["2026-01-01", 100], ["2026-09-01", 90]]), acct(2, "loan", [["2025-12-01", 500], ["2026-06-01", 470]])]
const top = topAccount(accts, kinds, "2026-01-01", "2026-10-01")
assert.deepStrictEqual([top?.account.id, top?.delta, top?.liability], [2, -30, true])
assert.deepStrictEqual(topAccount(accts, kinds, "2026-10-01", "2026-10-01"), undefined)

// a newly tracked account is an opening balance, not growth: left out of the movers and the top account
{
  const accts = [acct(1, "bank", [["2026-01-01", 100], ["2026-10-01", 120]]), acct(2, "us", [["2026-10-01", 500]]), acct(3, "loan", [["2026-06-01", 300], ["2026-10-01", 290]])]
  const o = openings(accts, kinds, "2026-01-01", "2026-10-01")
  assert.deepStrictEqual(o, { total: 200, byKind: { us: 500, loan: -300 }, count: 2 })
  const mv = movers(row("2026-01-01", 100, { bank: 100 }), row("2026-10-01", 330, { bank: 120, us: 500, loan: -290 }), kinds, o.byKind)
  assert.deepStrictEqual(mv.map((x) => [x.kind.key, x.delta]), [["bank", 20], ["loan", 10]])
  assert.deepStrictEqual(topAccount(accts, kinds, "2026-01-01", "2026-10-01")?.account.id, 1) // us: 500 → 500 is no move
}
