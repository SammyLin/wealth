import type { Liquidity } from "../../api/types"

// Pure helpers for the accounts feature. Self-check: `node src/features/accounts/logic.check.ts`.

/** Same rule as the server (POST /api/kinds). */
export const KEY_RE = /^[a-z][a-z0-9_]{1,31}$/

/** Liquidity tiers in balance-sheet order. `label` is Chinese; render with t(). */
export const LIQUIDITY: { value: Liquidity; label: string }[] = [
  { value: "liquid", label: "流動資產" },
  { value: "invest", label: "投資資產" },
  { value: "fixed", label: "自用資產" },
  { value: "liability", label: "負債" },
]

/** Default kind colors first, then a few that sit well next to them. */
export const SWATCHES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#4a3aa7", "#e34948", "#0e8a8a", "#8c6d3f", "#6f6556"]

/**
 * "Gold ETF" → "gold_etf". A name with no Latin letters (保險) falls back to `fallback` (the class's
 * liquidity, so the key still says something: "invest_2"); a suffix keeps it unique.
 */
export function slugKey(name: string, taken: readonly string[], fallback = "kind"): string {
  let base = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .slice(0, 28)
    .replace(/_+$/, "")
  if (base.length < 2) base = fallback
  let key = base
  for (let n = 2; taken.includes(key); n++) key = `${base}_${n}`
  return key
}

/** Copy of `list` with item `i` moved one step by `delta`; unchanged copy at the ends. */
export function moved<T>(list: readonly T[], i: number, delta: -1 | 1): T[] {
  const next = [...list]
  const j = i + delta
  if (j >= 0 && j < next.length) [next[i], next[j]] = [next[j], next[i]]
  return next
}
