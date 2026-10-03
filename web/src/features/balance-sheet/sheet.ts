import type { Account, Kind, Liquidity, Point } from "../../api/types.ts"
import { fmtInput, parseAmount, parseFx } from "../../lib/format.ts"

export { fmtInput }

// Pure balance-sheet math, shared by the section and the record dialog. Self-check: sheet.check.ts.

/** Asset tiers in balance-sheet order (how fast each turns into cash). Labels are Chinese; render with t(). */
export const TIERS: { id: Exclude<Liquidity, "liability">; label: string }[] = [
  { id: "liquid", label: "流動資產" },
  { id: "invest", label: "投資資產" },
  { id: "fixed", label: "自用資產" },
]

export type Group = { id: Liquidity; label: string; accounts: Account[]; total: number }

/** Latest value in the base currency; 0 before the first record. */
export const valueOf = (a: Account) => a.history.at(-1)?.value ?? 0

const liquidity = (kinds: Kind[]) => {
  const m = new Map(kinds.map((k) => [k.key, k.liquidity]))
  return (a: Account): Liquidity => m.get(a.kind) ?? "liquid"
}

/**
 * Archived accounts with a zero balance are hidden unless `showArchived`; archived ones that still hold
 * money stay visible, because they still count toward net worth and the two sides must add up.
 */
export function buildSheet(accounts: Account[], kinds: Kind[], showArchived: boolean) {
  const liq = liquidity(kinds)
  const hideable = (a: Account) => a.archived && valueOf(a) === 0
  const group = (id: Liquidity, label: string): Group => {
    const list = accounts.filter((a) => liq(a) === id && (showArchived || !hideable(a)))
    return { id, label, accounts: list, total: list.reduce((s, a) => s + valueOf(a), 0) }
  }
  const tiers = TIERS.map((x) => group(x.id, x.label)).filter((g) => g.accounts.length)
  const liabilities = group("liability", "負債")
  const assets = tiers.reduce((s, g) => s + g.total, 0)
  return { tiers, liabilities, assets, debt: liabilities.total, net: assets - liabilities.total, hiddenArchived: accounts.filter(hideable).length }
}

export const isLiability = (a: Account, kinds: Kind[]) => liquidity(kinds)(a) === "liability"

/** The account's balance as of `date`: its last record on or before that day, and whether that record is on the day itself. */
export function asOf(a: Account, date: string): { point?: Point; exact: boolean } {
  const point = a.history.findLast((p) => p.date <= date)
  return { point, exact: point?.date === date }
}

/** `touched` = the user typed in this row (amount or rate). Prefilled values alone are never saved. */
export type Draft = { amt: string; fx: string; touched?: boolean }
export type Parsed =
  | { kind: "empty" }
  | { kind: "error"; field: "amt" | "fx" }
  | { kind: "ok"; amount: number; fx: number; dirty: boolean; delta: number; overwrites: boolean }

/**
 * A row prefilled from the balance as of `date` (not the latest one, which may be later when backdating).
 * An account never recorded has no rate to fall back on: its fx starts empty (an error once an amount is
 * typed) until the day's rate arrives or is typed, so a foreign balance can't be saved at 1:1 by accident.
 */
export function prefill(a: Account, date: string): Draft {
  const { point } = asOf(a, date)
  const fx = point ? point.fx : a.history.length ? a.fx : null
  return { amt: point ? fmtInput(point.amount) : "", fx: fx === null ? "" : String(fx), touched: false }
}

/**
 * One row of the record dialog for `date`. `dirty` = the user typed in it and it differs from what is already
 * recorded on that day, so only those rows are saved; a rate that only changed because the day's rate was
 * prefilled never makes a row dirty. `delta` is the effect on net worth as of `date` (a liability going up
 * lowers it). `overwrites` = saving replaces a record that already exists on that day.
 */
export function parseDraft(a: Account, d: Draft, base: string, liability: boolean, date: string): Parsed {
  if (!d.amt.trim()) return { kind: "empty" }
  const amount = parseAmount(d.amt)
  if (Number.isNaN(amount)) return { kind: "error", field: "amt" }
  const fx = a.currency === base ? 1 : parseFx(d.fx)
  if (!(fx > 0)) return { kind: "error", field: "fx" }
  const { point, exact } = asOf(a, date)
  const dirty = !!d.touched && !(exact && amount === point!.amount && fx === point!.fx)
  const delta = dirty ? (amount * fx - (point?.value ?? 0)) * (liability ? -1 : 1) : 0
  return { kind: "ok", amount, fx, dirty, delta, overwrites: dirty && exact }
}
