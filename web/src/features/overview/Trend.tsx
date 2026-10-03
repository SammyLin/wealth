import { useMemo, useState } from "react"
import { ActionIcon, Button, EmptyState, Group, SegmentedControl, Skeleton, Stack, Text, Tooltip } from "@mantine/core"
import { LineChart } from "@mantine/charts"
import { ChartLine, MoveHorizontal, PenLine, ZoomOut } from "lucide-react"
import { useLedger, useMoney } from "../../api/useLedger"
import type { Event, Row } from "../../api/types"
import { t, T } from "../../i18n"
import { fmtDate, fmtPct, fmtTick, todayISO, toIso, toMs } from "../../lib/format"
import { SectionCard } from "../../shell/SectionCard"
import { useOpenDialog } from "../../shell/dialogs"
import { inPeriod, PERIOD_MONTHS, usefulPeriods, type Period } from "./data"

const PERIOD_LABEL: Record<Period, string> = { "3M": "3個月", "6M": "6個月", "1Y": "1年", "3Y": "3年", "5Y": "5年", all: "全部" }
const DAY = 864e5

type Zoom = [number, number] // brushed window, indexes into the period's rows

export function Trend() {
  const { state } = useLedger()
  const [picked, setPicked] = useState<Period | null>(null)
  const [zoom, setZoom] = useState<Zoom | null>(null)
  if (!state) return <TrendSkeleton />

  const options = usefulPeriods(state.series)
  const period = picked && options.includes(picked) ? picked : options.includes("1Y") ? "1Y" : "all"
  const rows = inPeriod(state.series, period)
  const z = zoom && zoom[1] < rows.length && (zoom[0] > 0 || zoom[1] < rows.length - 1) ? zoom : null
  const shown = z ? rows.slice(z[0], z[1] + 1) : rows
  const changeLabel = z
    ? `${fmtDate(shown[0].date)} → ${fmtDate(shown[shown.length - 1].date)}`
    : period === "all"
      ? T`自 ${fmtDate(rows[0]?.date ?? "")} 起`
      : PERIOD_MONTHS[period] < 12
        ? T`近 ${PERIOD_MONTHS[period]} 個月`
        : T`近 ${PERIOD_MONTHS[period] / 12} 年`

  return (
    <SectionCard
      title={t("淨資產趨勢")}
      description={shown.length > 1 ? <Change rows={shown} label={changeLabel} /> : t("每一次記錄的淨資產;虛線是你標記的大事。")}
      actions={
        <>
          {z && (
            <Tooltip label={t("還原縮放")}>
              <ActionIcon aria-label={t("還原縮放")} onClick={() => setZoom(null)}>
                <ZoomOut size={16} />
              </ActionIcon>
            </Tooltip>
          )}
          {options.length > 1 && (
            <SegmentedControl
              size="xs"
              aria-label={t("時間範圍")}
              value={period}
              onChange={(v) => {
                setPicked(v as Period)
                setZoom(null)
              }}
              data={options.map((p) => ({ value: p, label: t(PERIOD_LABEL[p]) }))}
            />
          )}
        </>
      }
    >
      {rows.length > 1 ? <Chart rows={rows} events={state.events} zoom={z} onZoom={setZoom} /> : <TooFew row={rows[0]} />}
    </SectionCard>
  )
}

function Chart({ rows, events, zoom, onZoom }: { rows: Row[]; events: Event[]; zoom: Zoom | null; onZoom: (z: Zoom) => void }) {
  const money = useMoney()
  const data = useMemo(() => rows.map((r) => ({ t: toMs(r.date), total: r.total })), [rows])
  const [first, last] = zoom ? [rows[zoom[0]], rows[zoom[1]]] : [rows[0], rows[rows.length - 1]]
  // Unzoomed, the axis runs on to the latest milestone up to today, so one marked after the last record still shows.
  const lastEvent = zoom ? 0 : Math.max(0, ...events.filter((e) => e.date > last.date && e.date <= todayISO()).map((e) => toMs(e.date)))
  const [x0, x1] = [toMs(first.date), Math.max(toMs(last.date), lastEvent)]
  const short = x1 - x0 < 200 * DAY
  const tick = (ms: number) => fmtTick(toIso(ms), short)
  const brush = data.length > 3
  const titleOf = (e: Event) => (e.title.length > 10 ? e.title.slice(0, 9) + "…" : e.title)
  // A nearly flat stretch would get ticks closer than the unit shows (−323.6K four times): keep the y range at
  // least 4% of the values so neighbouring labels differ.
  const totals = (zoom ? rows.slice(zoom[0], zoom[1] + 1) : rows).map((r) => r.total)
  const [lo, hi] = [Math.min(...totals), Math.max(...totals)]
  const minSpan = Math.max(Math.abs(lo), Math.abs(hi)) * 0.04 || 1
  const yDomain = hi - lo < minSpan ? [(lo + hi) / 2 - minSpan / 2, (lo + hi) / 2 + minSpan / 2] : ["auto", "auto"]
  // A label in the right fifth of the range is drawn to the left of its line so it isn't cut off at the edge.
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
        yAxisProps={{ width: 76, domain: yDomain }}
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
          height: 26,
          travellerWidth: 10,
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
          <Text fz="xs">{t("拖曳圖表下方滑桿的兩端(或用 Tab 選取後按方向鍵),放大一段期間")}</Text>
        </Group>
      )}
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
  const a = rows[0]
  const d = rows[rows.length - 1].total - a.total
  const color = d > 0 ? "var(--wealth-up)" : d < 0 ? "var(--wealth-down)" : undefined
  return (
    <>
      {label}{" "}
      <Text span inherit className="num" fw={500} c={color}>
        {money(d, { signed: true })}
        {a.total !== 0 && ` (${fmtPct(d / Math.abs(a.total), 1, true)})`}
      </Text>
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

function TrendSkeleton() {
  return (
    <SectionCard title={t("淨資產趨勢")}>
      <Skeleton h={{ base: 260, sm: 320 }} aria-busy="true" aria-label={t("載入中…")} />
    </SectionCard>
  )
}
