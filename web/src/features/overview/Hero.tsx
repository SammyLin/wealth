import { Box, Button, Card, ColorSwatch, Group, Progress, SimpleGrid, Text, Title, Tooltip } from "@mantine/core"
import { Clock, Minus, TrendingDown, TrendingUp } from "lucide-react"
import type { Account, Kind, Row, State } from "../../api/types"
import { useLedgerState, useMoney } from "../../api/useLedger"
import { t, T } from "../../i18n"
import { fmtDate, fmtPct, todayISO } from "../../lib/format"
import { liquidityColor, liquidityLabel } from "../../lib/liquidity"
import { useOpenDialog } from "../../shell/dialogs"
import { Stat } from "../../shell/Stat"
import { isStale } from "../balance-sheet/sheet"
import { liquidityMix, movers, topAccount } from "./data"
import { useTrendRange } from "./range"

/** Hero: net worth, change since the previous record, liquidity bar. Not a numbered section. */
export function Overview() {
  const { state } = useLedgerState()
  const money = useMoney()
  const { shown, label } = useTrendRange()

  const rows = state.series
  const last = rows.at(-1)
  const prev = rows.at(-2)
  const base = state.settings.base_currency
  const net = money(last?.total ?? 0)

  return (
    <SimpleGrid component="section" aria-labelledby="hero-label" cols={{ base: 1, md: 2 }} spacing={{ base: "xl", md: 48 }} py={{ base: "lg", sm: 48 }} style={{ alignItems: "end" }}>
      <Box miw={0}>
        <Group gap="sm" mb={8} wrap="nowrap">
          <Box w={28} h={1} bg="gold.5" aria-hidden />
          <Text id="hero-label" fz="sm" c="dimmed" lts=".14em" truncate>
            {last ? T`淨資產 · 截至 ${fmtDate(last.date)}` : `${t("淨資產")} · ${t("尚無紀錄")}`}
          </Text>
        </Group>
        {/* aria-label: the currency and the amount are separate words ("TWD 1,013.6萬"), not "TWD1,013.6萬" */}
        <Title
          order={1}
          className="num"
          fw={300}
          lh={0.95}
          lts="-.035em"
          aria-label={`${base} ${net}`}
          style={{ fontSize: `clamp(2.4rem, ${90 / net.length}vw, ${Math.min(6.2, 52 / net.length)}rem)`, whiteSpace: "nowrap" }}
        >
          <Text span inherit c="dimmed" fz=".28em" fw={400} lts=".02em" mr=".3em" style={{ verticalAlign: "super" }}>
            {base}
          </Text>
          {/* Fraunces' minus at display size is as wide as a digit and floats free of it ("—18.7萬" read as a
              dash): smaller, raised to the digits' middle and tucked against them */}
          {net.startsWith("−") ? (
            <>
              <span style={{ fontSize: ".62em", verticalAlign: ".22em", marginInlineEnd: ".04em" }}>−</span>
              {net.slice(1)}
            </>
          ) : (
            net
          )}
        </Title>
        {prev && last && <Delta value={last.total - prev.total} base={prev.total} label={T`較上一筆紀錄(${fmtDate(prev.date)})`} />}
        {shown.length > 1 && <Movers from={shown[0]} to={shown[shown.length - 1]} label={label} kinds={state.kinds} accounts={state.accounts} />}
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

/**
 * Why net worth moved over the trend's range (a different time base from the delta above, so it is labeled
 * with the range): the classes that changed most, then the single account that moved most. Each shows its own
 * balance's change, as the balance sheet does (a mortgage paid down reads −1.4萬); color and, for
 * liabilities, the note in brackets give the effect on net worth.
 */
function Movers({ from, to, label, kinds, accounts }: { from: Row; to: Row; label: string; kinds: Kind[]; accounts: Account[] }) {
  const top = movers(from, to, kinds).slice(0, 3)
  const acct = topAccount(accounts, kinds, from.date, to.date)
  if (!top.length) return null
  const kindOf = (key: string) => kinds.find((k) => k.key === key)
  return (
    <Group component="ul" gap="md" mt="xs" wrap="wrap" align="baseline" aria-label={T`${label}主要變動`} p={0} mb={0} style={{ listStyle: "none", rowGap: 4 }}>
      {/* one wrapping row, so on a narrow line the classes wrap one by one instead of all dropping under the label */}
      <Text component="li" fz="xs" c="dimmed">
        {T`${label}的變動:`}
      </Text>
      {top.map(({ kind, delta }) => (
        // movers() gives the effect on net worth; the label shows the class's own balance change
        <Mover key={kind.key} color={kind.color} name={t(kind.name)} balance={kind.liquidity === "liability" ? -delta : delta} liability={kind.liquidity === "liability"} />
      ))}
      {acct && (
        <Group component="li" gap={6} wrap="nowrap">
          <Text fz="xs" c="dimmed">
            {t("最大的帳戶:")}
          </Text>
          <Mover color={kindOf(acct.account.kind)?.color ?? "gray"} name={acct.account.name} balance={acct.delta} liability={acct.liability} inline />
        </Group>
      )}
    </Group>
  )
}

function Mover({ color, name, balance, liability, inline }: { color: string; name: string; balance: number; liability: boolean; inline?: boolean }) {
  const money = useMoney()
  const effect = liability ? -balance : balance
  return (
    <Group component={inline ? "div" : "li"} gap={6} wrap="nowrap">
      <ColorSwatch color={color} size={8} withShadow={false} aria-hidden />
      <Text fz="sm" c="dimmed" truncate maw={180}>
        {name}
      </Text>
      <Text fz="sm" className="num" c={effect > 0 ? "var(--wealth-up)" : "var(--wealth-down)"}>
        {money(balance, { signed: true })}
      </Text>
      {liability && (
        <Text fz="xs" c="dimmed" className="num">
          {T`(淨資產 ${money(effect, { signed: true })})`}
        </Text>
      )}
    </Group>
  )
}

/** A nudge when active accounts haven't been updated for a while: their old balance is still being carried. */
function Stale({ state }: { state: State }) {
  const open = useOpenDialog()
  const today = todayISO()
  const stale = state.accounts.filter((a) => isStale(a, today))
  if (!stale.length) return null
  const names = stale.slice(0, 4).map((a) => a.name)
  return (
    <Group gap={8} mt="sm" wrap="wrap" c="dimmed" align="center">
      <Clock size={14} aria-hidden />
      <Text fz="sm">{T`${stale.length} 個帳戶超過 90 天沒更新:${stale.length > 4 ? [...names, "…"] : names}`}</Text>
      <Button variant="subtle" size="compact-sm" onClick={() => open("record")}>
        {t("更新餘額")}
      </Button>
    </Group>
  )
}

function LiquidityCard() {
  const { state } = useLedgerState()
  const money = useMoney()
  const { tiers, assets, debt } = liquidityMix(state.series.at(-1), state.kinds)
  const share = (v: number) => (assets ? v / assets : 0)
  const summary = tiers.map((x) => `${t(liquidityLabel(x.tier))} ${fmtPct(share(x.value), 0)}`).join(t("、"))

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
              <Tooltip key={x.tier} label={`${t(liquidityLabel(x.tier))} ${money(x.value)}`}>
                <Progress.Section value={share(x.value) * 100} color={liquidityColor(x.tier)} aria-label={t(liquidityLabel(x.tier))} />
              </Tooltip>
            ))}
          </Progress.Root>
          <Group gap="xs" mt="sm" wrap="wrap" style={{ columnGap: "var(--mantine-spacing-md)" }}>
            {tiers.map((x) => (
              <Group key={x.tier} gap={6} wrap="nowrap">
                <ColorSwatch color={liquidityColor(x.tier)} size={10} withShadow={false} aria-hidden />
                <Text fz="xs" c="dimmed">
                  {t(liquidityLabel(x.tier))} <Text span className="num" inherit c="var(--mantine-color-text)">{share(x.value) < 0.005 ? "<1%" : fmtPct(share(x.value), 0)}</Text>
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
