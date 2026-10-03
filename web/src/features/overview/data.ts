import type { Kind, Liquidity, Row } from "../../api/types"
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

export type Tier = { tier: Exclude<Liquidity, "liability">; value: number; color: string }
export type Mix = { tiers: Tier[]; assets: number; debt: number }

const ASSET_TIERS = ["liquid", "invest", "fixed"] as const

/** Latest row → asset value per liquidity tier (colored by the tier's biggest kind), total assets, debt (positive). */
export function liquidityMix(row: Row | undefined, kinds: Kind[]): Mix {
  const sum = { liquid: 0, invest: 0, fixed: 0 }
  const top: Record<string, { v: number; color: string }> = {}
  let debt = 0
  for (const k of kinds) {
    const v = row?.by_kind[k.key] ?? 0
    if (k.liquidity === "liability") {
      debt += -v
      continue
    }
    const pos = Math.max(0, v)
    sum[k.liquidity] += pos
    if (pos > (top[k.liquidity]?.v ?? 0)) top[k.liquidity] = { v: pos, color: k.color }
  }
  const tiers = ASSET_TIERS.filter((t) => sum[t] > 0).map((t) => ({ tier: t, value: sum[t], color: top[t].color }))
  return { tiers, assets: sum.liquid + sum.invest + sum.fixed, debt: Math.max(0, debt) }
}
