import { useMemo } from "react"
import { Box, Group, Paper, Stack, Text } from "@mantine/core"
import { BarChart } from "@mantine/charts"
import type { LoanView, Sched } from "../../api/types"
import { useMoney } from "../../api/useLedger"
import { T, t } from "../../i18n"
import { fmtDate } from "../../lib/format"
import { loanColor, monthTotal } from "./math"

type Props = { loans: LoanView[]; schedule: Sched[]; today: string }

/** Monthly payment from the first payment to payoff, stacked by loan, with a marker at this month. */
export function PaymentChart({ loans, schedule, today }: Props) {
  const money = useMoney()
  const month = today.slice(0, 7)

  const { data, series, ticks } = useMemo(() => {
    const data = schedule.map((r) => {
      const row: Record<string, string | number> = { month: r.month }
      for (const [id, v] of Object.entries(r.by)) row[`l${id}`] = Math.round(v)
      return row
    })
    const series = loans.map((l, i) => ({ name: `l${l.id}`, label: l.name, color: loanColor(i) }))
    // Year labels on January, spaced so about six fit on a phone, counted from the first January so the
    // early years are labeled too.
    const y0 = Number(schedule.find((r) => r.month.endsWith("-01"))?.month.slice(0, 4))
    const step = Math.max(1, Math.ceil((schedule.length / 12) / 6))
    const ticks = schedule.map((r) => r.month).filter((m) => m.endsWith("-01") && (Number(m.slice(0, 4)) - y0) % step === 0)
    return { data, series, ticks }
  }, [loans, schedule])

  if (!schedule.length) return null
  const first = schedule[0].month
  const last = schedule[schedule.length - 1].month
  const peak = Math.max(...schedule.map(monthTotal))
  const inRange = month >= first && month <= last
  const summary = T`每月貸款月付長條圖,從 ${fmtDate(first)} 到 ${fmtDate(last)} 繳清;最高每月 ${money(peak)},本月 ${money(
    monthTotal(schedule.find((r) => r.month === month)),
  )}`

  return (
    <Box role="img" aria-label={summary}>
      <BarChart
        h={260}
        data={data}
        dataKey="month"
        series={series}
        type="stacked"
        gridAxis="x"
        tickLine="none"
        valueFormatter={(v) => money(v)}
        // no per-bar keyboard layer: hundreds of unnamed bars would bury the summary in the aria-label above
        barChartProps={{ barCategoryGap: 0, accessibilityLayer: false }}
        // Same-color stroke closes the hairline seams between adjacent month bars.
        barProps={(s) => ({ isAnimationActive: false, stroke: s.color, strokeOpacity: 1, strokeWidth: 0.5 })}
        xAxisProps={{ ticks, interval: 0, tickFormatter: (m: string) => m.slice(0, 4) }}
        yAxisProps={{ width: 56 }}
        referenceLines={inRange ? [{ x: month, color: "var(--mantine-color-text)", label: t("今天"), labelPosition: "insideTopLeft" }] : []}
        tooltipProps={{
          content: ({ label, payload }) => <Tip month={String(label ?? "")} payload={payload} series={series} money={money} />,
        }}
      />
    </Box>
  )
}

type TipProps = {
  month: string
  payload?: readonly { name?: unknown; value?: unknown }[]
  series: { name: string; label: string; color: string }[]
  money: (v: number) => string
}

function Tip({ month, payload, series, money }: TipProps) {
  const items = (payload ?? []).filter((p) => Number(p.value) > 0)
  if (!items.length) return null
  return (
    <Paper withBorder shadow="md" p="sm" radius="md" miw={180}>
      <Text fz="xs" c="dimmed" mb={6}>
        {fmtDate(month)}
      </Text>
      <Stack gap={4}>
        {items.map((p) => {
          const s = series.find((s) => s.name === p.name)
          return (
            <Group key={String(p.name)} justify="space-between" gap="md" wrap="nowrap">
              <Group gap={6} wrap="nowrap">
                <Box w={8} h={8} style={{ borderRadius: 2, background: s?.color }} aria-hidden />
                <Text fz="xs">{s?.label}</Text>
              </Group>
              <Text fz="xs" className="num">
                {money(Number(p.value))}
              </Text>
            </Group>
          )
        })}
        <Group justify="space-between" gap="md" pt={4} style={{ borderTop: "1px solid var(--wealth-rule)" }}>
          <Text fz="xs" fw={600}>
            {t("合計")}
          </Text>
          <Text fz="xs" fw={600} className="num">
            {money(items.reduce((s, p) => s + Number(p.value), 0))}
          </Text>
        </Group>
      </Stack>
    </Paper>
  )
}
