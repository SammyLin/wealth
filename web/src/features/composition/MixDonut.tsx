import { DonutChart } from "@mantine/charts"
import { ColorSwatch, Group, Stack, Text } from "@mantine/core"
import type { Kind, Row } from "../../api/types"
import { useMoney } from "../../api/useLedger"
import { T, t } from "../../i18n"
import { fmtDate, fmtPct } from "../../lib/format"

/** The latest record's mix of the given kinds, with a text legend (name, share, amount) in class order, like the stack beside it. */
export function MixDonut({ row, kinds }: { row: Row; kinds: Kind[] }) {
  const money = useMoney()
  // A donut can't show zero or negative slices; those kinds simply have no share today.
  const data = kinds
    .map((k) => ({ key: k.key, name: t(k.name), value: row.by_kind[k.key] ?? 0, color: k.color }))
    .filter((d) => d.value > 0)
  const total = data.reduce((s, d) => s + d.value, 0)

  if (!data.length)
    return (
      <Text c="dimmed" fz="sm" ta="center" py="xl">
        {T`${fmtDate(row.date)} 這幾類都沒有餘額。`}
      </Text>
    )

  const summary = data.map((d) => `${d.name} ${fmtPct(d.value / total)}`).join(t("、"))
  return (
    <Stack align="center" gap="md">
      <DonutChart
        role="img"
        aria-label={T`${fmtDate(row.date)} 資產比例:${summary}`}
        data={data}
        size={160}
        thickness={22}
        paddingAngle={1}
        withLabels
        withLabelsLine={false}
        // slices under 3% get no label (they crowded each other); the legend below lists every share
        pieProps={{ label: SliceLabel }}
        tooltipDataSource="segment"
        valueFormatter={money}
        chartLabel={money(total)}
        styles={{ label: { fontFamily: "var(--wealth-font-num)" } }}
      />
      <Stack component="ul" gap={6} w="100%" maw={320} m={0} p={0} style={{ listStyle: "none" }}>
        {data.map((d) => (
          <Group component="li" key={d.key} justify="space-between" wrap="nowrap" gap="sm">
            <Group gap={8} wrap="nowrap" miw={0}>
              <ColorSwatch color={d.color} size={10} withShadow={false} aria-hidden />
              <Text fz="sm" truncate>
                {d.name}
              </Text>
            </Group>
            <Group gap="sm" wrap="nowrap">
              <Text className="num" fz="sm" c="dimmed">
                {money(d.value)}
              </Text>
              <Text className="num" fz="sm" fw={600} w={52} ta="right">
                {fmtPct(d.value / total)}
              </Text>
            </Group>
          </Group>
        ))}
      </Stack>
    </Stack>
  )
}

type LabelProps = { x: number; y: number; cx: number; percent?: number }
const SliceLabel = ({ x, y, cx, percent = 0 }: LabelProps) =>
  percent < 0.03 ? null : (
    <text x={x} y={y} textAnchor={x > cx ? "start" : "end"} fill="var(--mantine-color-dimmed)" fontFamily="var(--wealth-font-num)" fontSize={12}>
      {fmtPct(percent, 0)}
    </text>
  )
