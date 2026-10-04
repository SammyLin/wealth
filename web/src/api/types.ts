// Mirrors the Go JSON (docs/BRIEF.md "JSON shapes"). Dates are "YYYY-MM-DD", months "YYYY-MM".

export type Liquidity = "liquid" | "invest" | "fixed" | "liability"
export type Unit = "wan" | "k" | "full"
export type SectionId = "trend" | "mix" | "sheet" | "loans" | "events"

export type Kind = { key: string; name: string; color: string; liquidity: Liquidity; sort: number }

export type Point = { date: string; value: number; amount: number; fx: number } // value = amount*fx (base ccy)

export type Account = {
  id: number
  name: string
  kind: string
  currency: string
  archived: boolean
  sort: number
  note: string
  amount: number // latest, original currency
  fx: number // latest rate to the base currency
  history: Point[]
}

export type Row = { date: string; total: number; by_kind: Record<string, number> } // liabilities negative

export type Event = { id: number; date: string; title: string }

export type Loan = {
  id: number
  account_id: number | null
  name: string
  principal: number
  rate: number // fraction, 0.021 = 2.1%
  start: string
  grace_months: number
  total_months: number
}

export type LoanView = Loan & {
  grace_end: string
  payment_now: number
  grace_payment: number
  level_payment: number
  balance_now: number
  end_date: string
}

export type Sched = { month: string; total: number; by: Record<string, number> } // by: loan id → payment

export type Settings = {
  title: string
  subtitle: string
  base_currency: string
  unit: Unit
  layout: string // JSON-encoded Layout; parse with useLayout()
  /** JSON {accounts, loans, events}: ids the demo ledger wrote; "" when there is no demo to clear */
  demo: string
  /** JSON list of account ids the stale-balance nudge skips; "" for none */
  stale_muted: string
  /** net-worth goal for the hero: amount in the base currency as a plain number string, "" for none */
  target_amount: string
  /** "YYYY-MM-DD" or "" */
  target_date: string
}

export type Layout = { sections: { id: SectionId; hidden: boolean }[] }

export type State = {
  file_backups: boolean
  settings: Settings
  kinds: Kind[]
  accounts: Account[]
  series: Row[]
  events: Event[]
  loans: LoanView[]
  loan_schedule: Sched[]
}

// Request bodies
export type Snapshot = { account_id: number; date: string; amount: number; fx: number }
export type NewAccount = { name: string; kind: string; currency: string; note?: string }
export type AccountPatch = Partial<Pick<Account, "name" | "currency" | "archived" | "kind" | "sort" | "note">>
export type KindInput = Omit<Kind, "key">
export type EventInput = Omit<Event, "id"> & { id?: number }
export type LoanInput = Omit<Loan, "id"> & { id?: number }

// Errors and the CSV import preview (POST /api/import?dry_run=1)
export type ApiError = { error: string; key?: string; params?: unknown[] }
/** fx 0 = looked up on import; currency "" for a name with no account and no pick yet. */
type PreviewRow = { line: number; date: string; account: string; amount: number; fx: number; currency: string; overwrites: boolean }
/** A name no account has yet, with the CSV's kind / currency cells (raw, may be empty) as defaults. */
export type UnknownAccount = { name: string; kind: string; currency: string }
export type ImportPreview = { rows: PreviewRow[]; unknown_accounts: UnknownAccount[]; errors: ApiError[]; fx_lookups: number }
