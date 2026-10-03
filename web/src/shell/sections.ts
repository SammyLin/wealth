import { lazy, useCallback, useMemo, type ComponentType } from "react"
import { useLedger } from "../api/useLedger"
import type { Layout, SectionId } from "../api/types"
import { BalanceSheet } from "../features/balance-sheet/BalanceSheet"
import { Events } from "../features/events"

// The chart sections load on demand: recharts is most of the bundle, and the hero and balance sheet don't need it.
const Trend = lazy(() => import("../features/overview/Trend").then((m) => ({ default: m.Trend })))
const Composition = lazy(() => import("../features/composition"))
const Loans = lazy(() => import("../features/loans"))

// Dashboard sections in default order. `label` is Chinese; render it with t(label).
export const SECTIONS: { id: SectionId; label: string; component: ComponentType }[] = [
  { id: "trend", label: "淨資產趨勢", component: Trend },
  { id: "mix", label: "資產組成", component: Composition },
  { id: "sheet", label: "資產負債表", component: BalanceSheet },
  { id: "loans", label: "貸款", component: Loans },
  { id: "events", label: "大事記", component: Events },
]

type Entry = Layout["sections"][number]

/** settings.layout (JSON, may be empty or stale) → every known section exactly once, saved order first. */
function resolveLayout(json: string | undefined): Entry[] {
  let saved: unknown
  try {
    saved = JSON.parse(json || "{}").sections
  } catch {
    /* bad JSON → defaults */
  }
  const out: Entry[] = []
  for (const s of Array.isArray(saved) ? saved : [])
    if (SECTIONS.some((d) => d.id === s?.id) && !out.some((o) => o.id === s.id)) out.push({ id: s.id, hidden: !!s.hidden })
  for (const d of SECTIONS) if (!out.some((o) => o.id === d.id)) out.push({ id: d.id, hidden: false })
  return out
}

/** Reads and writes settings.layout. For the dashboard (visible) and the layout editor (sections, save). */
export function useLayout() {
  const { state, saveSettings } = useLedger()
  const sections = useMemo(() => resolveLayout(state?.settings.layout), [state?.settings.layout])
  const visible = useMemo(
    () => sections.filter((s) => !s.hidden).map((s) => SECTIONS.find((d) => d.id === s.id)!),
    [sections],
  )
  const save = useCallback(
    (next: Entry[]) => saveSettings({ layout: JSON.stringify({ sections: next } satisfies Layout) }),
    [saveSettings],
  )
  return { sections, visible, save }
}
