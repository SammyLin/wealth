import type { Loan, LoanInput, LoanView, Sched } from "../../api/types.ts"
import { parseDay } from "../../lib/format.ts"

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

/** "2026-01-31" + 1 → "2026-02-28": the day clamps to the target month's end, like addMonths in loan.go. */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number)
  const lastDay = new Date(Date.UTC(y, m + months, 0)).getUTCDate()
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDay))).toISOString().slice(0, 10)
}

type Field = "name" | "principal" | "rate" | "start" | "grace_months" | "total_months"
const TERM = "總期數 1–600 個月,寬限期要小於總期數"

/**
 * validLoan() in internal/ledger/model.go, per field: the Chinese message for each field at fault (render
 * with t()). testdata/loans.json "validation" holds the cases both are tested against.
 */
export function loanErrors(l: LoanInput): Partial<Record<Field, string>> {
  const e: Partial<Record<Field, string>> = {}
  const name = l.name.trim()
  if (!name) e.name = "名稱和本金必填"
  else if ([...name].length > 60) e.name = "文字太長"
  if (!(l.principal > 0)) e.principal = "名稱和本金必填"
  else if (l.principal > 1e15) e.principal = "本金太大"
  if (!(l.rate >= 0 && l.rate <= 0.2)) e.rate = "年利率要在 0–20% 之間"
  if (!Number.isInteger(l.total_months) || l.total_months <= 0 || l.total_months > 600) e.total_months = TERM
  if (!Number.isInteger(l.grace_months) || l.grace_months < 0 || !(l.grace_months < l.total_months)) e.grace_months = TERM
  const year = Number(l.start.slice(0, 4))
  if (parseDay(l.start) !== l.start) e.start = "起始日期格式錯誤"
  else if (year < 1900 || year >= 2200) e.start = "日期要在 1900–2199 年之間"
  return e
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

// Tranche colors: gold, slate, rust, olive… alternating hue and lightness so neighbouring tranches in the
// stacked payment chart are told apart at a glance (three shades of gold were not); light-dark() keeps them
// legible on the dark card.
const LOAN_COLORS = [
  "light-dark(#7d5803, #e8cf8e)",
  "light-dark(#3f6e8c, #8fb3cc)",
  "light-dark(#b0612a, #e09a68)",
  "light-dark(#5d7a3a, #a8c48a)",
  "light-dark(#6f6556, #b3a78f)",
  "light-dark(#d4a52f, #a87203)",
]
export const loanColor = (i: number) => LOAN_COLORS[i % LOAN_COLORS.length]
