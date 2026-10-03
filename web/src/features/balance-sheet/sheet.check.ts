// Self-check, not bundled: `node src/features/balance-sheet/sheet.check.ts` (Node ≥ 23 strips the types).
import type { Account, Kind } from "../../api/types.ts"
import { buildSheet, parseDraft, prefill } from "./sheet.ts"

const eq = (got: unknown, want: unknown) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}
const kinds: Kind[] = [
  { key: "bank", name: "銀行", color: "#000", liquidity: "liquid", sort: 0 },
  { key: "home", name: "不動產", color: "#000", liquidity: "fixed", sort: 1 },
  { key: "loan", name: "房貸", color: "#000", liquidity: "liability", sort: 2 },
]
const acct = (id: number, kind: string, amount: number, fx = 1, archived = false, currency = "TWD"): Account => ({
  id, name: `a${id}`, kind, currency, archived, sort: id, note: "", amount, fx,
  history: amount || fx !== 1 ? [{ date: "2026-01-01", value: amount * fx, amount, fx }] : [],
})
const accts = [acct(1, "bank", 100), acct(2, "bank", 10, 30, false, "USD"), acct(3, "home", 1000), acct(4, "loan", 600), acct(5, "bank", 0, 1, true), acct(6, "bank", 50, 1, true)]

const s = buildSheet(accts, kinds, false)
eq([s.assets, s.debt, s.net, s.hiddenArchived], [1450, 600, 850, 1])
eq(s.assets, s.debt + s.net)
eq(s.tiers.map((g) => [g.id, g.accounts.map((a) => a.id)]), [["liquid", [1, 2, 6]], ["fixed", [3]]])
eq(buildSheet(accts, kinds, true).tiers[0].accounts.length, 4)

const base = "TWD"
const day = "2026-02-01"
const typed = (amt: string, fx = "1") => ({ amt, fx, touched: true })
eq(parseDraft(accts[0], { amt: "", fx: "1" }, base, false, day), { kind: "empty" })
eq(parseDraft(accts[0], typed("abc"), base, false, day), { kind: "error", field: "amt" })
eq(parseDraft(accts[0], prefill(accts[0], day), base, false, day), { kind: "ok", amount: 100, fx: 1, dirty: false, delta: 0, overwrites: false })
eq(parseDraft(accts[0], typed("1.5萬", ""), base, false, day), { kind: "ok", amount: 15000, fx: 1, dirty: true, delta: 14900, overwrites: false })
eq(parseDraft(accts[1], typed("10", "0"), base, false, day), { kind: "error", field: "fx" })
eq(parseDraft(accts[1], typed("10", "31"), base, false, day), { kind: "ok", amount: 10, fx: 31, dirty: true, delta: 10, overwrites: false })
eq(parseDraft(accts[3], typed("500"), base, true, day), { kind: "ok", amount: 500, fx: 1, dirty: true, delta: 100, overwrites: false })
// the day's rate prefilled into an untouched foreign row is not a change
eq(parseDraft(accts[1], { amt: "10", fx: "32.01", touched: false }, base, false, day).kind === "ok" && parseDraft(accts[1], { amt: "10", fx: "32.01" }, base, false, day), {
  kind: "ok", amount: 10, fx: 32.01, dirty: false, delta: 0, overwrites: false,
})

// Backfill: history on 01-01 (100) and 03-01 (300). Recording 02-01 compares with 01-01, not the latest.
const hist: Account = {
  ...acct(7, "bank", 300),
  history: [
    { date: "2026-01-01", value: 100, amount: 100, fx: 1 },
    { date: "2026-03-01", value: 300, amount: 300, fx: 1 },
  ],
}
eq(prefill(hist, "2026-02-01"), { amt: "100", fx: "1", touched: false })
eq(prefill(hist, "2025-12-01"), { amt: "", fx: "1", touched: false })
eq(parseDraft(hist, prefill(hist, "2026-02-01"), base, false, "2026-02-01").kind === "ok" && (parseDraft(hist, prefill(hist, "2026-02-01"), base, false, "2026-02-01") as { dirty: boolean }).dirty, false)
eq(parseDraft(hist, typed("300"), base, false, "2026-02-01"), { kind: "ok", amount: 300, fx: 1, dirty: true, delta: 200, overwrites: false })
// on a day that already has a record: same value is no change, a new value overwrites it
eq(parseDraft(hist, typed("100"), base, false, "2026-01-01"), { kind: "ok", amount: 100, fx: 1, dirty: false, delta: 0, overwrites: false })
eq(parseDraft(hist, typed("120"), base, false, "2026-01-01"), { kind: "ok", amount: 120, fx: 1, dirty: true, delta: 20, overwrites: true })

// Rates for a weak currency against a strong base keep full precision (USD ledger: KRW, IDR, VND).
const usd = (id: number, cur: string): Account => ({ ...acct(id, "bank", 0), currency: cur, history: [] })
for (const [cur, rate] of [["KRW", 0.00074458], ["IDR", 0.0000559], ["VND", 0.0000385]] as const) {
  const p = parseDraft(usd(20, cur), typed("100000000", String(rate)), "USD", false, day)
  eq(p.kind === "ok" && p.fx, rate)
  eq(p.kind === "ok" && Math.round(p.delta), Math.round(1e8 * rate))
}
// Never-recorded foreign account: no 1:1 default; an amount without a rate is an fx error.
eq(prefill(usd(21, "JPY"), day), { amt: "", fx: "", touched: false })
eq(parseDraft(usd(21, "JPY"), { ...prefill(usd(21, "JPY"), day), amt: "1000", touched: true }, "USD", false, day), { kind: "error", field: "fx" })
console.log("sheet.check ok")
