import { useMemo, useState } from "react"
import { Button, EmptyState, Grid, Group, Skeleton, Text } from "@mantine/core"
import { ChartArea, PenLine } from "lucide-react"
import { useLedger } from "../../api/useLedger"
import { t, T } from "../../i18n"
import { fmtDate } from "../../lib/format"
import { useOpenDialog } from "../../shell/dialogs"
import { SectionCard } from "../../shell/SectionCard"
import { KindChips } from "./KindChips"
import { MixDonut } from "./MixDonut"
import { StackChart } from "./StackChart"

/** Stacked area of asset kinds over time, a kind filter (chips double as the legend) and the latest mix. */
export function Composition() {
  const { state } = useLedger()
  const open = useOpenDialog()
  const [picked, setPicked] = useState<string[]>([]) // empty = every kind

  // Asset kinds (not liabilities) that ever held a value, in the user's kind order.
  const kinds = useMemo(
    () => (state?.kinds ?? []).filter((k) => k.liquidity !== "liability" && state?.series.some((r) => r.by_kind[k.key])),
    [state],
  )
  const shown = useMemo(() => (picked.length ? kinds.filter((k) => picked.includes(k.key)) : kinds), [kinds, picked])

  if (!state)
    return (
      <SectionCard title={t("資產組成")}>
        <Skeleton h={{ base: 220, sm: 300 }} aria-label={t("載入中…")} />
      </SectionCard>
    )

  const rows = state.series
  if (!kinds.length)
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

  const last = rows[rows.length - 1]
  return (
    <SectionCard
      title={t("資產組成")}
      description={T`各類資產疊起來的高度,截至 ${fmtDate(last.date)}。點類別只看那幾類,可複選。`}
      actions={<KindChips kinds={kinds} value={picked} onChange={setPicked} />}
    >
      <Grid gap="xl" align="center">
        <Grid.Col span={{ base: 12, md: 8 }}>
          {rows.length > 1 ? (
            <StackChart rows={rows} kinds={shown} />
          ) : (
            <Text c="dimmed" fz="sm" ta="center" py="xl">
              {t("再記一筆不同日期的餘額,就能看到各類資產的變化。")}
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
