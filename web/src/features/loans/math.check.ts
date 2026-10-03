// Self-check, not bundled: `node src/features/loans/math.check.ts` (Node ≥ 23 strips the types).
// Expected values come from internal/ledger/loan.go for the same inputs.
import { addMonths, levelPayment, pctToRate, rateToPct, totalInterest } from "./math.ts"

const near = (got: number, want: number) => {
  if (Math.abs(got - want) > 0.01) throw new Error(`got ${got}, want ${want}`)
}
const eq = (got: unknown, want: unknown) => {
  if (got !== want) throw new Error(`got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}
const tranche = { principal: 10_000_000, rate: 0.021, grace_months: 36, total_months: 360 }
near(levelPayment(tranche), 40462.96) // 324 level months at 2.1%
near(levelPayment({ ...tranche, rate: 0 }), 10_000_000 / 324)
eq(levelPayment({ ...tranche, grace_months: 360 }), 0)
near(totalInterest({ principal: 1200, rate: 0, grace_months: 0, total_months: 12 }), 0)
eq(addMonths("2026-01-31", 1), "2026-03-03")
eq(addMonths("2024-05-15", 360), "2054-05-15")
eq(pctToRate(2.185), 0.02185)
eq(rateToPct(0.02185), 2.185)
console.log("loans math ok")
