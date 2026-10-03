import type { Loan, LoanView, Sched } from "../../api/types"

// Client-side mirror of internal/ledger/loan.go (grace = interest-only, then level payments 本息平均攤還).
// Used for the LoanModal preview; the dashboard itself reads the server's LoanView / loan_schedule.

type Terms = Pick<Loan, "principal" | "rate" | "grace_months" | "total_months">

export const gracePayment = (l: Terms) => (l.principal * l.rate) / 12

export function levelPayment(l: Terms): number {
  const r = l.rate / 12
  const n = l.total_months - l.grace_months
  if (n <= 0) return 0
  if (r === 0) return l.principal / n
  return (l.principal * r) / (1 - Math.pow(1 + r, -n))
}

/** Interest paid over the whole term: grace interest + level payments − principal. */
export const totalInterest = (l: Terms) =>
  gracePayment(l) * l.grace_months + levelPayment(l) * (l.total_months - l.grace_months) - l.principal

/** "2026-01-31" + 1 → "2026-03-03": same month overflow as Go's time.AddDate, so dates match the server. */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10)
}

/** Sum of each loan's rounded payment, the way the bank statement shows it. */
export const monthTotal = (row?: Sched) => (row ? Object.values(row.by).reduce((s, v) => s + Math.round(v), 0) : 0)

export type LoanStatus = "pending" | "grace" | "repaying" | "paid"

export function loanStatus(l: LoanView, today: string): LoanStatus {
  if (today.slice(0, 7) <= l.start.slice(0, 7)) return "pending" // first payment is the month after start
  if (l.grace_months > 0 && today < l.grace_end) return "grace"
  if (today.slice(0, 7) > l.end_date.slice(0, 7) || l.balance_now <= 0) return "paid"
  return "repaying"
}

/** The next time this loan's payment changes: first payment, grace ends, or payoff. */
export function nextChange(l: LoanView, today: string): { kind: "start" | "grace" | "payoff"; date: string; amount: number } | null {
  switch (loanStatus(l, today)) {
    case "pending":
      return { kind: "start", date: addMonths(l.start, 1), amount: l.grace_months > 0 ? l.grace_payment : l.level_payment }
    case "grace":
      return { kind: "grace", date: l.grace_end, amount: l.level_payment }
    case "repaying":
      return { kind: "payoff", date: l.end_date, amount: 0 }
    default:
      return null
  }
}

/** Percent typed in the form → the fraction the API stores, without float noise: 2.185 → 0.02185. */
export const pctToRate = (pct: number) => Math.round(pct * 1e4) / 1e6
export const rateToPct = (rate: number) => Math.round(rate * 1e6) / 1e4

// v1's gold-to-slate tranche colors; light-dark() keeps them legible on the dark card.
const LOAN_COLORS = [
  "light-dark(#5c4203, #f1d68a)",
  "light-dark(#9a6b05, #d9a520)",
  "light-dark(#ca8a04, #a87203)",
  "light-dark(#e2b54a, #7a5604)",
  "light-dark(#7a8a99, #8fa1b3)",
  "light-dark(#6f6556, #b3a78f)",
]
export const loanColor = (i: number) => LOAN_COLORS[i % LOAN_COLORS.length]
