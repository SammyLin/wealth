/* oxlint-disable react/only-export-components -- the provider and its hook belong together */
import { createContext, useContext, useState, type ReactNode } from "react"
import { useLedgerState } from "../../api/useLedger"
import { T } from "../../i18n"
import { fmtDate } from "../../lib/format"
import { inPeriod, inRange, PERIOD_MONTHS, usefulPeriods, type Period } from "./data"

// The trend's time range (preset, typed custom range, brushed zoom), shared so the hero's movers and the
// composition chart describe the same stretch of time the trend shows.

export type RangeKind = Period | "custom"
export type Zoom = [number, number] // brushed window, indexes into the range's rows
type Picked = { kind: RangeKind | null; custom: [string, string] | null; zoom: Zoom | null }

const RangeContext = createContext<[Picked, (p: Partial<Picked>) => void] | null>(null)

export function RangeProvider({ children }: { children: ReactNode }) {
  const [picked, setPicked] = useState<Picked>({ kind: null, custom: null, zoom: null })
  return <RangeContext.Provider value={[picked, (p) => setPicked((prev) => ({ ...prev, ...p }))]}>{children}</RangeContext.Provider>
}

export function useTrendRange() {
  const { state } = useLedgerState()
  const ctx = useContext(RangeContext)
  if (!ctx) throw new Error("useTrendRange must be used inside <RangeProvider>")
  const [picked, set] = ctx
  const options = usefulPeriods(state.series)
  const kind: RangeKind =
    picked.kind === "custom" && picked.custom ? "custom" : picked.kind && picked.kind !== "custom" && options.includes(picked.kind) ? picked.kind : options.includes("1Y") ? "1Y" : "all"
  const rows = kind === "custom" ? inRange(state.series, ...picked.custom!) : inPeriod(state.series, kind)
  const z = picked.zoom
  const zoom = z && z[1] < rows.length && (z[0] > 0 || z[1] < rows.length - 1) ? z : null
  const shown = zoom ? rows.slice(zoom[0], zoom[1] + 1) : rows
  const label = zoom
    ? `${fmtDate(shown[0]?.date ?? "")} → ${fmtDate(shown.at(-1)?.date ?? "")}`
    : kind === "custom"
      ? `${fmtDate(picked.custom![0])} → ${fmtDate(picked.custom![1])}`
      : kind === "all"
        ? T`自 ${fmtDate(rows[0]?.date ?? "")} 起`
        : PERIOD_MONTHS[kind] < 12
          ? T`近 ${PERIOD_MONTHS[kind]} 個月`
          : T`近 ${PERIOD_MONTHS[kind] / 12} 年`
  return {
    options,
    kind,
    custom: picked.custom,
    rows, // the range, for the chart
    zoom,
    shown, // the range after zoom: what the figures describe
    label,
    setKind: (k: RangeKind) => set({ kind: k, zoom: null, custom: k === "custom" ? (picked.custom ?? [rows[0]?.date ?? "", rows.at(-1)?.date ?? ""]) : picked.custom }),
    setCustom: (c: [string, string]) => set({ kind: "custom", custom: c, zoom: null }),
    setZoom: (zoom: Zoom | null) => set({ zoom }),
  }
}
