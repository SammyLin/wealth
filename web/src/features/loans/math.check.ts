// Self-check, not bundled: `node src/features/loans/math.check.ts` (Node 22.18+ strips the types); `npm run check` runs every *.check.ts with node --test.
// Expected values come from internal/ledger/loan.go for the same inputs.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { addMonths, levelPayment, loanErrors, pctToRate, rateToPct, totalInterest } from "./math.ts"

// The same cases internal/ledger/loan.go is tested against (TestLoanVectors).
const vectors = JSON.parse(readFileSync(new URL("../../../../internal/ledger/testdata/loans.json", import.meta.url), "utf8"))
for (const c of vectors.cases) assert.ok(Math.abs(levelPayment(c) - c.level) < 1e-6, `${JSON.stringify(c)}: ${levelPayment(c)}`)
for (const [from, n, want] of vectors.add_months) assert.deepStrictEqual(addMonths(from, n), want, `${from} + ${n}`)
// Go returns the first problem; the form shows one per field, so Go's message must be among them (none when valid)
for (const { loan, error } of vectors.validation) {
  const msgs = Object.values(loanErrors({ ...loan, account_id: null }))
  assert.ok(error ? msgs.includes(error) : msgs.length === 0, `${JSON.stringify(loan)}: ${msgs}, want ${error}`)
}
assert.ok(vectors.add_months.length && vectors.validation.length)

const near = (got: number, want: number, tol = 0.01) => assert.ok(Math.abs(got - want) <= tol, `got ${got}, want ${want}`)
const tranche = { principal: 10_000_000, rate: 0.021, grace_months: 36, total_months: 360 }
near(levelPayment(tranche), 40462.96) // 324 level months at 2.1%
near(levelPayment({ ...tranche, rate: 0 }), 10_000_000 / 324)
assert.deepStrictEqual(levelPayment({ ...tranche, grace_months: 360 }), 0)
near(totalInterest({ principal: 1200, rate: 0, grace_months: 0, total_months: 12 }), 0)
assert.deepStrictEqual(pctToRate(2.185), 0.02185)
assert.deepStrictEqual(rateToPct(0.02185), 2.185)

// simulator: no extras reproduces the closed form; extras shorten and save; grace-period extras shrink the jump
import { extraToFinishBy, simulate } from "./math.ts"
{
  const l = { ...tranche, start: "2021-06-15" }
  const base = simulate(l)
  assert.deepStrictEqual(base.months, 360)
  assert.deepStrictEqual(base.end_date, "2051-06-15")
  near(base.interest, totalInterest(tranche), 1) // month-by-month vs closed form, within a dollar
  near(base.level, levelPayment(tranche))
  const more = simulate(l, { extra: 10_000 })
  assert.ok(more.months < 360 && more.interest < base.interest)
  assert.ok(more.level < base.level, "extra during the grace period lowers the level payment")
  const lump = simulate(l, { lump: { month: "2030-01", amount: 1_000_000 } })
  assert.ok(lump.months < 360 && lump.level === base.level, "a lump sum after grace keeps the payment, shortens the term")
  assert.deepStrictEqual(simulate(l, { lump: { month: "2010-01", amount: 1e9 } }).months, 360, "a lump before the start is ignored")
  const need = extraToFinishBy(l, "2041-06")
  assert.ok(need > 0 && simulate(l, { extra: need }).months <= 240 && simulate(l, { extra: need - 1 }).months > 240)
  assert.deepStrictEqual(extraToFinishBy(l, "2060-01"), 0)
  assert.ok(Number.isNaN(extraToFinishBy(l, "2021-06")))
  near(simulate({ principal: 1200, rate: 0, grace_months: 0, total_months: 12, start: "2026-01-01" }).interest, 0)
}
