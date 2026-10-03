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
