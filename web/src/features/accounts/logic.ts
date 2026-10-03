// Pure helpers for the accounts feature. Self-check: `node src/features/accounts/logic.check.ts`.

/** Same rule as the server (POST /api/kinds). */
export const KEY_RE = /^[a-z][a-z0-9_]{1,31}$/

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

/** Copy of `list` with item `from` moved to index `to` (clamped to the ends): a step, or straight to the top or bottom. */
export function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item)
  return next
}

/**
 * KindSelect's Enter guard: true while the text typed in the select isn't the selected option's label
 * (half-typed, or matching nothing), so Enter must not submit the form with the previous value.
 */
export const staleSearch = (text: string, value: string | null | undefined, data: { value: string; label: string }[]) =>
  text !== (data.find((d) => d.value === value)?.label ?? "")
