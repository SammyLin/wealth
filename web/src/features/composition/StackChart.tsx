import { useMemo } from "react"
import { AreaChart } from "@mantine/charts"
import type { Kind, Row } from "../../api/types"
import { useMoney } from "../../api/useLedger"
import { T, t } from "../../i18n"
import { fmtDate, fmtTick, toIso as iso, toMs as ms } from "../../lib/format"
import { ChartTable } from "../../shell/ChartTable"

/** Stacked areas of the given kinds on a real time axis (records are irregularly spaced); `percent` stacks shares to 100%. */
export function StackChart({ rows, kinds, percent }: { rows: Row[]; kinds: Kind[]; percent?: boolean }) {
  const money = useMoney()
  const data = useMemo(
    () => rows.map((r) => Object.fromEntries([["t", ms(r.date)], ...kinds.map((k) => [k.key, r.by_kind[k.key] ?? 0])])),
    [rows, kinds],
  )
  const first = rows[0]
  const last = rows[rows.length - 1]
  const total = kinds.reduce((s, k) => s + (last.by_kind[k.key] ?? 0), 0)
  const short = ms(last.date) - ms(first.date) < 120 * 864e5 // under ~4 months, months would repeat on the axis
  const names = kinds.map((k) => t(k.name)).join(t("、"))

  return (
    <>
      <AreaChart
        h={{ base: 220, sm: 300 }}
        role="img"
        aria-label={T`堆疊面積圖:${names},${fmtDate(first.date)} 至 ${fmtDate(last.date)},最新合計 ${money(total)}`}
        data={data}
        dataKey="t"
        type={percent ? "percent" : "stacked"}
        series={kinds.map((k) => ({ name: k.key, label: t(k.name), color: k.color }))}
        curveType="monotone"
        withDots={false}
        fillOpacity={0.75}
        strokeWidth={1}
        gridAxis="y"
        areaChartProps={{ accessibilityLayer: false }} // the aria-label summary speaks for the chart
        valueFormatter={money}
        xAxisProps={{
          type: "number",
          scale: "time",
          domain: ["dataMin", "dataMax"],
          tickFormatter: (v: number) => fmtTick(iso(v), short),
          minTickGap: 32,
        }}
        yAxisProps={{ width: 64 }}
        tooltipProps={{ labelFormatter: (v) => (Number.isFinite(Number(v)) ? fmtDate(iso(Number(v))) : "") }}
      />
      <ChartTable
        caption={t("資產組成")}
        head={[t("日期"), ...kinds.map((k) => t(k.name))]}
        rows={() => rows.map((r) => [fmtDate(r.date), ...kinds.map((k) => money(r.by_kind[k.key] ?? 0))])}
      />
    </>
  )
}
