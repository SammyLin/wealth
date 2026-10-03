import { useMemo } from "react"
import { ActionIcon, Button, EmptyState, Group, SegmentedControl, Stack, Text, Tooltip } from "@mantine/core"
import { LineChart } from "@mantine/charts"
import { DateInput } from "@mantine/dates"
import { useMediaQuery } from "@mantine/hooks"
import { CalendarDays, ChartLine, MoveHorizontal, PenLine, ZoomOut } from "lucide-react"
import { useLedgerState, useMoney } from "../../api/useLedger"
import type { Event, Row } from "../../api/types"
import { t, T } from "../../i18n"
import { fmtDate, fmtPct, fmtTick, parseDay, todayISO, toIso, toMs } from "../../lib/format"
import { ChartTable } from "../../shell/ChartTable"
import { SectionCard } from "../../shell/SectionCard"
import { useOpenDialog } from "../../shell/dialogs"
import { niceTicks } from "./data"
import { useTrendRange, type RangeKind, type Zoom } from "./range"

const RANGE_LABEL: Record<RangeKind, string> = { "3M": "3個月", "6M": "6個月", "1Y": "1年", "3Y": "3年", "5Y": "5年", all: "全部", custom: "自訂" }
const DAY = 864e5

export function Trend() {
  const { state } = useLedgerState()
  const range = useTrendRange()
  const { kind, rows, zoom, shown } = range
  const choices: RangeKind[] = state.series.length > 2 ? [...range.options, "custom"] : range.options

  return (
    <SectionCard
      title={t("淨資產趨勢")}
      description={shown.length > 1 ? <Change rows={shown} label={range.label} /> : t("每一次記錄的淨資產;虛線是你標記的大事。")}
      actions={
        <>
          {zoom && (
            <Tooltip label={t("還原縮放")}>
              <ActionIcon aria-label={t("還原縮放")} onClick={() => range.setZoom(null)}>
                <ZoomOut size={16} />
              </ActionIcon>
            </Tooltip>
          )}
          {choices.length > 1 && (
            <SegmentedControl
              size="xs"
              aria-label={t("時間範圍")}
              value={kind}
              onChange={(v) => range.setKind(v as RangeKind)}
              data={choices.map((p) => ({ value: p, label: t(RANGE_LABEL[p]) }))}
            />
          )}
        </>
      }
    >
      {kind === "custom" && range.custom && <CustomRange value={range.custom} onChange={range.setCustom} />}
      {rows.length > 1 ? (
        <Chart rows={rows} events={state.events} zoom={zoom} onZoom={range.setZoom} />
      ) : kind === "custom" ? (
        <Text c="dimmed" fz="sm" ta="center" py="xl">
          {t("這段期間的紀錄不到兩筆,畫不出趨勢。")}
        </Text>
      ) : (
        <TooFew row={rows[0]} />
      )}
    </SectionCard>
  )
}

/** Two typed dates (2026-01-01, 2026.1.1 or "Jan 1, 2026"); the range is whatever records fall between them. */
function CustomRange({ value: [from, to], onChange }: { value: [string, string]; onChange: (v: [string, string]) => void }) {
  const today = todayISO()
  const field = { size: "xs", dateParser: parseDay, maxDate: today, leftSection: <CalendarDays size={14} aria-hidden />, w: 150 } as const
  return (
    <Group gap="xs" mb="sm" wrap="wrap">
      <DateInput {...field} label={t("從")} value={from} onChange={(v) => v && onChange(v <= to ? [v, to] : [v, v])} />
      <DateInput {...field} label={t("到")} value={to} onChange={(v) => v && onChange(v >= from ? [from, v] : [v, v])} />
    </Group>
  )
}

function Chart({ rows, events, zoom, onZoom }: { rows: Row[]; events: Event[]; zoom: Zoom | null; onZoom: (z: Zoom) => void }) {
  const money = useMoney()
  const coarse = useMediaQuery("(pointer: coarse)")
  const data = useMemo(() => rows.map((r) => ({ t: toMs(r.date), total: r.total })), [rows])
  const [first, last] = zoom ? [rows[zoom[0]], rows[zoom[1]]] : [rows[0], rows[rows.length - 1]]
  // Unzoomed, the axis runs on to the latest milestone up to today, so one marked after the last record still shows.
  const lastEvent = zoom ? 0 : Math.max(0, ...events.filter((e) => e.date > last.date && e.date <= todayISO()).map((e) => toMs(e.date)))
  const [x0, x1] = [toMs(first.date), Math.max(toMs(last.date), lastEvent)]
  const short = x1 - x0 < 200 * DAY
  const tick = (ms: number) => fmtTick(toIso(ms), short)
  const brush = data.length > 3
  // by code point, so an emoji is never cut in half
  const titleOf = (e: Event) => {
    const cps = [...e.title]
    return cps.length > 12 ? cps.slice(0, 11).join("").trimEnd() + "…" : e.title
  }
  // Round ticks (d3-style) on a range at least 4% of the values wide, so a nearly flat stretch doesn't get
  // neighbouring labels that read the same in the chosen unit (−323.6K four times).
  const totals = (zoom ? rows.slice(zoom[0], zoom[1] + 1) : rows).map((r) => r.total)
  const [lo, hi] = [Math.min(...totals), Math.max(...totals)]
  const minSpan = Math.max(Math.abs(lo), Math.abs(hi)) * 0.04 || 1
  const yTicks = hi - lo < minSpan ? niceTicks((lo + hi) / 2 - minSpan / 2, (lo + hi) / 2 + minSpan / 2) : niceTicks(lo, hi)
  // A label in the right fifth of the range ends at its line instead of starting there, so it isn't cut off at the edge.
  const side = (e: Event) => (toMs(e.date) > x0 + (x1 - x0) * 0.8 ? "insideTopRight" : "insideTopLeft")

  return (
    <Stack gap="xs">
      <LineChart
        h={{ base: 260, sm: 320 }}
        role="figure"
        aria-label={T`淨資產趨勢折線圖,${rows.length} 筆紀錄,從 ${fmtDate(first.date)} 的 ${money(first.total)} 到 ${fmtDate(last.date)} 的 ${money(last.total)}`}
        data={data}
        dataKey="t"
        series={[{ name: "total", label: t("淨資產"), color: "var(--mantine-primary-color-filled)" }]}
        curveType="monotone"
        strokeWidth={2.25}
        dotProps={{ r: data.length <= 24 ? 3 : 0 }}
        activeDotProps={{ r: 5, strokeWidth: 2, stroke: "var(--mantine-color-body)" }}
        valueFormatter={(v) => money(v)}
        xAxisProps={{ type: "number", scale: "time", domain: ["dataMin", (max: number) => Math.max(max, lastEvent)], tickFormatter: tick }}
        yAxisProps={{ width: 76, domain: [yTicks[0], yTicks[yTicks.length - 1]], ticks: yTicks, interval: 0 }}
        referenceLines={events.map((e) => ({
          x: toMs(e.date),
          label: titleOf(e),
          labelPosition: side(e),
          color: "dimmed",
          strokeDasharray: "4 4",
        }))}
        tooltipProps={{ labelFormatter: (label) => <TipLabel ms={Number(label)} events={events} /> }}
        withBrush={brush}
        brushProps={{
          // handles wide enough to grab with a finger (the 44px rule can't reach recharts' SVG)
          height: 36,
          travellerWidth: 24,
          fill: "var(--wealth-paper-2)",
          stroke: "var(--mantine-color-gold-5)",
          tickFormatter: () => "", // the range is shown in the section description instead (traveller text clips at the edge)
          // the two handles are keyboard sliders (Tab, then ← →); recharts would announce raw timestamps
          ariaLabel: T`縮放範圍:${fmtDate(first.date)} 到 ${fmtDate(last.date)}`,
          startIndex: zoom?.[0] ?? 0,
          endIndex: zoom?.[1] ?? data.length - 1,
          onChange: ({ startIndex, endIndex }) => onZoom([startIndex, endIndex]),
        }}
      />
      {brush && (
        <Group gap={6} c="dimmed" justify="center">
          <MoveHorizontal size={14} aria-hidden />
          {/* on touch the range buttons and the custom dates above are the easier way in */}
          <Text fz="xs">{coarse ? t("用上方的時間範圍或「自訂」日期縮放,或拖曳圖表下方滑桿的兩端") : t("拖曳圖表下方滑桿的兩端(或用 Tab 選取後按方向鍵),放大一段期間")}</Text>
        </Group>
      )}
      <ChartTable
        caption={t("淨資產趨勢")}
        head={[t("日期"), t("淨資產")]}
        rows={() => (zoom ? rows.slice(zoom[0], zoom[1] + 1) : rows).map((r) => [fmtDate(r.date), money(r.total)])}
      />
    </Stack>
  )
}

/** Tooltip title: the record's date, plus any milestone on that day. */
function TipLabel({ ms, events }: { ms: number; events: Event[] }) {
  if (!Number.isFinite(ms)) return null // recharts renders the tooltip before anything is hovered
  const iso = toIso(ms)
  const here = events.filter((e) => e.date === iso)
  return (
    <>
      <Text className="num" fz="sm" fw={500}>
        {fmtDate(iso)}
      </Text>
      {here.map((e) => (
        <Text key={e.id} fz="xs" c="gold">
          {e.title}
        </Text>
      ))}
    </>
  )
}

function Change({ rows, label }: { rows: Row[]; label: string }) {
  const money = useMoney()
  const a = rows[0], z = rows[rows.length - 1]
  const d = z.total - a.total
  const color = d > 0 ? "var(--wealth-up)" : d < 0 ? "var(--wealth-down)" : undefined
  // Over longer ranges the change per year too (a plain average: compounding means nothing once net worth is negative);
  // under 1.5 years it would just repeat the total
  const years = (toMs(z.date) - toMs(a.date)) / (365.25 * DAY)
  return (
    <>
      {label}{" "}
      <Text span inherit className="num" fw={500} c={color}>
        {money(d, { signed: true })}
        {a.total !== 0 && ` (${fmtPct(d / Math.abs(a.total), 1, true)})`}
      </Text>
      {years >= 1.5 && (
        <Text span inherit className="num">
          {" · "}
          {T`平均每年 ${money(d / years, { signed: true })}`}
        </Text>
      )}
    </>
  )
}

function TooFew({ row }: { row: Row | undefined }) {
  const open = useOpenDialog()
  const money = useMoney()
  return (
    <EmptyState
      variant="light"
      py="xl"
      icon={<ChartLine size={24} />}
      title={row ? t("再記一筆,就能畫出趨勢") : t("還沒有任何紀錄")}
      description={row ? T`目前只有 ${fmtDate(row.date)} 一筆:${money(row.total)}。` : t("記下各帳戶今天的餘額,這裡就會開始畫出你的淨資產。")}
    >
      <EmptyState.Actions>
        <Group justify="center">
          <Button leftSection={<PenLine size={16} />} onClick={() => open("record")}>
            {t("記一筆")}
          </Button>
        </Group>
      </EmptyState.Actions>
    </EmptyState>
  )
}
