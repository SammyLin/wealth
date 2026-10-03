import { Box, Button, Card, ColorSwatch, Group, Progress, SimpleGrid, Skeleton, Stack, Text, Title, Tooltip } from "@mantine/core"
import { Clock, Minus, TrendingDown, TrendingUp } from "lucide-react"
import type { Kind, Row, State } from "../../api/types"
import { useLedger, useMoney } from "../../api/useLedger"
import { t, T } from "../../i18n"
import { fmtDate, fmtPct, todayISO, toIso, toMs } from "../../lib/format"
import { useOpenDialog } from "../../shell/dialogs"
import { liquidityMix, movers, type Tier } from "./data"

const TIER_LABEL: Record<Tier["tier"], string> = { liquid: "流動資產", invest: "投資資產", fixed: "自用資產" }

/** Hero: net worth, change since the previous record, liquidity bar. Not a numbered section. */
export function Overview() {
  const { state } = useLedger()
  const money = useMoney()
  if (!state) return <HeroSkeleton />

  const rows = state.series
  const last = rows.at(-1)
  const prev = rows.at(-2)
  const total = last?.total ?? 0
  const net = money(total)

  return (
    <SimpleGrid component="section" aria-labelledby="hero-label" cols={{ base: 1, md: 2 }} spacing={{ base: "xl", md: 48 }} py={{ base: "lg", sm: 48 }} style={{ alignItems: "end" }}>
      <Box miw={0}>
        <Group gap="sm" mb={8} wrap="nowrap">
          <Box w={28} h={1} bg="gold.5" aria-hidden />
          <Text id="hero-label" fz="sm" c="dimmed" lts=".14em" truncate>
            {last ? T`淨資產 · 截至 ${fmtDate(last.date)}` : `${t("淨資產")} · ${t("尚無紀錄")}`}
          </Text>
        </Group>
        <Title order={1} className="num" fw={300} lh={0.95} lts="-.035em" style={{ fontSize: `clamp(2.4rem, ${90 / net.length}vw, ${Math.min(6.2, 52 / net.length)}rem)`, whiteSpace: "nowrap" }}>
          <Text span inherit c="dimmed" fz=".28em" fw={400} lts=".02em" mr=".3em" style={{ verticalAlign: "super" }}>
            {state.settings.base_currency}
          </Text>
          {net}
        </Title>
        {prev && last && <Delta value={last.total - prev.total} base={prev.total} label={T`較上次 ${fmtDate(prev.date)}`} />}
        {prev && last && <Movers prev={prev} last={last} kinds={state.kinds} />}
        <Stale state={state} />
      </Box>
      <LiquidityCard />
    </SimpleGrid>
  )
}

function Delta({ value, base, label }: { value: number; base: number; label: string }) {
  const money = useMoney()
  const dir = value > 0 ? "up" : value < 0 ? "down" : null
  const Icon = dir === "up" ? TrendingUp : dir === "down" ? TrendingDown : Minus
  const color = dir ? `var(--wealth-${dir})` : "var(--mantine-color-dimmed)"
  return (
    <Group gap={8} mt="md" wrap="wrap">
      <Group gap={6} wrap="nowrap" c={color}>
        <Icon size={16} aria-hidden />
        <Text className="num" fw={500} inherit>
          {money(value, { signed: true })}
          {base !== 0 && ` (${fmtPct(value / Math.abs(base), 1, true)})`}
        </Text>
      </Group>
      <Text fz="sm" c="dimmed">
        {label}
      </Text>
    </Group>
  )
}

/** Why net worth moved: the kinds that changed most between the last two records, signed by their effect. */
function Movers({ prev, last, kinds }: { prev: Row; last: Row; kinds: Kind[] }) {
  const money = useMoney()
  const top = movers(prev, last, kinds).slice(0, 3)
  if (!top.length) return null
  return (
    <Group component="ul" gap="md" mt="xs" wrap="wrap" aria-label={t("主要變動")} p={0} style={{ listStyle: "none" }}>
      {top.map(({ kind, delta }) => (
        <Group component="li" key={kind.key} gap={6} wrap="nowrap">
          <ColorSwatch color={kind.color} size={8} withShadow={false} aria-hidden />
          <Text fz="sm" c="dimmed">
            {t(kind.name)}
          </Text>
          <Text fz="sm" className="num" c={delta > 0 ? "var(--wealth-up)" : "var(--wealth-down)"}>
            {money(delta, { signed: true })}
          </Text>
        </Group>
      ))}
    </Group>
  )
}

const STALE_DAYS = 90

/** A nudge when active accounts haven't been updated for a while: their old balance is still being carried. */
function Stale({ state }: { state: State }) {
  const open = useOpenDialog()
  const cutoff = toIso(toMs(todayISO()) - STALE_DAYS * 864e5)
  const stale = state.accounts.filter((a) => !a.archived && a.history.length && a.history[a.history.length - 1].date < cutoff)
  if (!stale.length) return null
  return (
    <Group gap={8} mt="sm" wrap="wrap" c="dimmed">
      <Clock size={14} aria-hidden />
      <Text fz="sm" title={stale.map((a) => a.name).join(t("、"))}>
        {T`${stale.length} 個帳戶超過 90 天沒更新`}
      </Text>
      <Button variant="subtle" size="compact-sm" onClick={() => open("record")}>
        {t("更新餘額")}
      </Button>
    </Group>
  )
}

function LiquidityCard() {
  const { state } = useLedger()
  const money = useMoney()
  if (!state) return null
  const { tiers, assets, debt } = liquidityMix(state.series.at(-1), state.kinds)
  const share = (v: number) => (assets ? v / assets : 0)
  const summary = tiers.map((x) => `${t(TIER_LABEL[x.tier])} ${fmtPct(share(x.value), 0)}`).join(t("、"))

  return (
    <Card>
      <Title order={2} fz="md" lts=".04em">
        {t("資產流動性")}
      </Title>
      <Text fz="xs" c="dimmed" mb="md">
        {t("隨時能動用的錢佔多少,一眼看清。")}
      </Text>
      {assets > 0 ? (
        <>
          <Progress.Root size={28} radius="sm" aria-label={T`資產流動性:${summary}`}>
            {tiers.map((x) => (
              <Tooltip key={x.tier} label={`${t(TIER_LABEL[x.tier])} ${money(x.value)}`}>
                <Progress.Section value={share(x.value) * 100} color={x.color} aria-label={t(TIER_LABEL[x.tier])} />
              </Tooltip>
            ))}
          </Progress.Root>
          <Group gap="xs" mt="sm" wrap="wrap" style={{ columnGap: "var(--mantine-spacing-md)" }}>
            {tiers.map((x) => (
              <Group key={x.tier} gap={6} wrap="nowrap">
                <ColorSwatch color={x.color} size={10} withShadow={false} aria-hidden />
                <Text fz="xs" c="dimmed">
                  {t(TIER_LABEL[x.tier])} <Text span className="num" inherit c="var(--mantine-color-text)">{share(x.value) < 0.005 ? "<1%" : fmtPct(share(x.value), 0)}</Text>
                </Text>
              </Group>
            ))}
          </Group>
        </>
      ) : (
        <Text fz="sm" c="dimmed">
          {t("記下第一筆資產後,這裡會顯示流動性比例。")}
        </Text>
      )}
      <SimpleGrid cols={3} spacing="sm" mt="md" pt="sm" style={{ borderTop: "1px dashed var(--wealth-rule)" }}>
        <Stat label={t("總資產")} value={money(assets)} />
        <Stat label={t("負債")} value={money(debt)} />
        <Stat label={t("負債比")} value={assets ? fmtPct(debt / assets, 0) : "—"} align="right" />
      </SimpleGrid>
    </Card>
  )
}

function Stat({ label, value, align }: { label: string; value: string; align?: "right" }) {
  return (
    <Stack gap={0} ta={align} miw={0}>
      <Text fz="xs" c="dimmed" truncate>
        {label}
      </Text>
      <Text className="num" fz="lg" fw={500} style={{ whiteSpace: "nowrap" }}>
        {value}
      </Text>
    </Stack>
  )
}

function HeroSkeleton() {
  return (
    <Stack gap="sm" py={{ base: "lg", sm: "xl" }} aria-busy="true" aria-label={t("載入中…")}>
      <Skeleton h={14} w={180} />
      <Skeleton h={72} w="70%" maw={520} />
      <Skeleton h={12} w="40%" />
      <Skeleton h={28} mt="md" />
    </Stack>
  )
}
