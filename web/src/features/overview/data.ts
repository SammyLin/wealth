import type { Account, Kind, Liquidity, Row } from "../../api/types"
import { toIso, toMs } from "../../lib/format.ts"

// Pure helpers for the hero and the trend chart. Self-check: `node src/features/overview/data.check.ts`.

export type Period = "3M" | "6M" | "1Y" | "3Y" | "5Y" | "all"
export const PERIOD_MONTHS: Record<Period, number> = { "3M": 3, "6M": 6, "1Y": 12, "3Y": 36, "5Y": 60, all: 0 }

/** Rows within the period before the latest record, plus the one before the window so the line reaches the left edge. */
export function inPeriod(rows: Row[], p: Period): Row[] {
  const months = PERIOD_MONTHS[p]
  if (!months || rows.length < 2) return rows
  const end = new Date(toMs(rows[rows.length - 1].date))
  end.setUTCMonth(end.getUTCMonth() - months)
  const from = toIso(end.getTime())
  const i = rows.findIndex((r) => r.date >= from)
  return rows.slice(Math.max(0, i - 1))
}

/** Rows from `from` to `to` (inclusive), plus the one before `from` when no record falls on it (its balance is what `from` starts at). */
export function inRange(rows: Row[], from: string, to: string): Row[] {
  const i = rows.findIndex((r) => r.date >= from)
  if (i < 0) return rows.slice(-1)
  return rows.slice(rows[i].date === from ? i : Math.max(0, i - 1)).filter((r) => r.date <= to)
}

/**
 * Round axis ticks covering lo..hi, d3-style: steps of 1, 2, 2.5 or 5 × 10^n, about `n` of them, the first
 * and last on or outside the data, so the top tick is a round number instead of the data's maximum.
 */
export function niceTicks(lo: number, hi: number, n = 5): number[] {
  if (!(hi > lo)) [lo, hi] = [lo - (Math.abs(lo) || 1) * 0.02, hi + (Math.abs(hi) || 1) * 0.02]
  const raw = (hi - lo) / n
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw * 0.999)!
  const first = Math.floor(lo / step), last = Math.ceil(hi / step)
  return Array.from({ length: last - first + 1 }, (_, i) => Number(((first + i) * step).toPrecision(12)))
}

/** Presets worth offering: "all" plus every preset that trims something and shows more than the shorter one before it. */
export function usefulPeriods(rows: Row[]): Period[] {
  let prev = 0
  return (["3M", "6M", "1Y", "3Y", "5Y", "all"] as const).filter((p) => {
    const n = inPeriod(rows, p).length
    if (p !== "all" && (n >= rows.length || n === prev)) return false
    prev = n
    return true
  })
}

/** Per kind, how much its contribution to net worth changed from `prev` to `last` (liabilities are already negative), biggest first. */
export function movers(prev: Row, last: Row, kinds: Kind[]): { kind: Kind; delta: number }[] {
  return kinds
    .map((kind) => ({ kind, delta: (last.by_kind[kind.key] ?? 0) - (prev.by_kind[kind.key] ?? 0) }))
    .filter((m) => Math.abs(m.delta) >= 0.5)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
}

/**
 * The account that moved net worth most from `from` to `to` (each account's balance carried forward to both
 * dates, as the series does): its own balance change and whether it is a liability (then net worth moved the
 * other way). Undefined when nothing moved.
 */
export function topAccount(accounts: Account[], kinds: Kind[], from: string, to: string) {
  const liab = new Set(kinds.filter((k) => k.liquidity === "liability").map((k) => k.key))
  const at = (a: Account, d: string) => a.history.findLast((p) => p.date <= d)?.value ?? 0
  let best: { account: Account; delta: number; liability: boolean } | undefined
  for (const a of accounts) {
    const delta = at(a, to) - at(a, from)
    if (Math.abs(delta) >= 0.5 && Math.abs(delta) > Math.abs(best?.delta ?? 0)) best = { account: a, delta, liability: liab.has(a.kind) }
  }
  return best
}

type Tier = { tier: Exclude<Liquidity, "liability">; value: number }
const ASSET_TIERS = ["liquid", "invest", "fixed"] as const

/** Latest row → asset value per liquidity tier, total assets, debt (positive). Tier colors are fixed (lib/liquidity.ts). */
export function liquidityMix(row: Row | undefined, kinds: Kind[]): { tiers: Tier[]; assets: number; debt: number } {
  const sum = { liquid: 0, invest: 0, fixed: 0 }
  let debt = 0
  for (const k of kinds) {
    const v = row?.by_kind[k.key] ?? 0
    if (k.liquidity === "liability") debt += -v
    else sum[k.liquidity] += Math.max(0, v)
  }
  const tiers = ASSET_TIERS.filter((t) => sum[t] > 0).map((t) => ({ tier: t, value: sum[t] }))
  return { tiers, assets: sum.liquid + sum.invest + sum.fixed, debt: Math.max(0, debt) }
}
