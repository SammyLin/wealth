import { useMemo, useState } from "react"
import { Button, Chip, EmptyState, Grid, Group, SegmentedControl, Text } from "@mantine/core"
import { ChartArea, PenLine } from "lucide-react"
import { useLedgerState } from "../../api/useLedger"
import { t, T } from "../../i18n"
import { fmtDate } from "../../lib/format"
import { useOpenDialog } from "../../shell/dialogs"
import { SectionCard } from "../../shell/SectionCard"
import { useTrendRange } from "../overview/range"
import { KindChips } from "./KindChips"
import { MixDonut } from "./MixDonut"
import { StackChart } from "./StackChart"

/**
 * Stacked area of asset kinds over the trend's range (its preset, custom range or zoom), a kind filter (chips
 * double as the legend), amounts or shares, an "exclude personal-use" switch (a home can be 80% of the stack)
 * and the latest mix.
 */
export function Composition() {
  const { state } = useLedgerState()
  const open = useOpenDialog()
  const { shown: rows, label } = useTrendRange()
  const [picked, setPicked] = useState<string[]>([]) // empty = every kind
  const [percent, setPercent] = useState(false)
  const [noFixed, setNoFixed] = useState(false)

  // Asset kinds (not liabilities) that ever held a value, in the user's kind order.
  const kinds = useMemo(
    () => state.kinds.filter((k) => k.liquidity !== "liability" && (!noFixed || k.liquidity !== "fixed") && state.series.some((r) => r.by_kind[k.key])),
    [state, noFixed],
  )
  const shown = useMemo(() => (picked.length ? kinds.filter((k) => picked.includes(k.key)) : kinds), [kinds, picked])
  const hasFixed = state.kinds.some((k) => k.liquidity === "fixed" && state.series.some((r) => r.by_kind[k.key]))

  if (!kinds.length && !noFixed)
    return (
      <SectionCard title={t("資產組成")}>
        <EmptyState
          variant="light"
          icon={<ChartArea size={24} />}
          title={t("還沒有資產紀錄")}
          description={t("記下各帳戶的餘額後,這裡會畫出每類資產的變化和目前比例。")}
        >
          <EmptyState.Actions>
            <Group justify="center">
              <Button leftSection={<PenLine size={16} />} onClick={() => open("record")}>
                {t("記一筆")}
              </Button>
            </Group>
          </EmptyState.Actions>
        </EmptyState>
      </SectionCard>
    )

  const last = rows[rows.length - 1] ?? state.series[state.series.length - 1]
  return (
    <SectionCard
      title={t("資產組成")}
      description={T`各類資產疊起來的高度(${label}),截至 ${fmtDate(last.date)}。點類別只看那幾類,可複選。`}
      actions={<KindChips kinds={kinds} value={picked.filter((k) => kinds.some((x) => x.key === k))} onChange={setPicked} />}
    >
      <Group gap="sm" mb="md" wrap="wrap">
        <SegmentedControl
          size="xs"
          aria-label={t("顯示方式")}
          value={percent ? "percent" : "amount"}
          onChange={(v) => setPercent(v === "percent")}
          data={[
            { value: "amount", label: t("金額") },
            { value: "percent", label: t("比例") },
          ]}
        />
        {hasFixed && (
          <Chip size="xs" checked={noFixed} onChange={setNoFixed}>
            {t("不含自用資產")}
          </Chip>
        )}
      </Group>
      <Grid gap="xl" align="center">
        <Grid.Col span={{ base: 12, md: 8 }}>
          {rows.length > 1 && shown.length ? (
            <StackChart rows={rows} kinds={shown} percent={percent} />
          ) : (
            <Text c="dimmed" fz="sm" ta="center" py="xl">
              {shown.length ? t("再記一筆不同日期的餘額,就能看到各類資產的變化。") : t("這幾類都沒有紀錄。")}
            </Text>
          )}
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <MixDonut row={last} kinds={shown} />
        </Grid.Col>
      </Grid>
    </SectionCard>
  )
}

export default Composition
