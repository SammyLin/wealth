import type { Liquidity } from "../api/types.ts"

/**
 * Liquidity tiers in balance-sheet order (how fast each turns into cash). `label` is Chinese; render with t().
 * `color` is the tier's own, fixed (a gold ramp from cash to illiquid, lighter on the dark card), so the hero's
 * liquidity bar keeps its colors when the biggest class inside a tier changes.
 */
export const LIQUIDITY: { value: Liquidity; label: string; color: string }[] = [
  { value: "liquid", label: "流動資產", color: "light-dark(#5f4302, #f1e2bb)" },
  { value: "invest", label: "投資資產", color: "light-dark(#ca8a04, #d4a52f)" },
  { value: "fixed", label: "自用資產", color: "light-dark(#e8cf8e, #7d5803)" },
  { value: "liability", label: "負債", color: "var(--wealth-down)" },
]

export const liquidityLabel = (l: Liquidity) => LIQUIDITY.find((x) => x.value === l)!.label
export const liquidityColor = (l: Liquidity) => LIQUIDITY.find((x) => x.value === l)!.color
