import { Badge, Box, Divider, Group, Paper, Stack, Text } from "@mantine/core"
import { TrendingDown, TrendingUp } from "lucide-react"
import type { Account, LoanView, Sched } from "../../api/types"
import { useMoney } from "../../api/useLedger"
import { T, t } from "../../i18n"
import { fmtDate } from "../../lib/format"
import { loanColor, monthTotal } from "./math"

type Props = { loans: LoanView[]; schedule: Sched[]; accounts: Account[]; today: string }

type PayGroup = { key: string; name: string; loans: LoanView[] }

/** This month's payments, grouped by the liability account (one mortgage, several tranches), then what changes next. */
export function ThisMonth({ loans, schedule, accounts, today }: Props) {
  const money = useMoney()
  const month = today.slice(0, 7)
  const i = schedule.findIndex((r) => r.month === month)
  const cur = schedule[i]
  const total = monthTotal(cur)
  const pay = (l: LoanView) => Math.round(cur?.by[l.id] ?? 0)

  const groups: PayGroup[] = []
  for (const l of loans.filter(pay)) {
    const key = l.account_id ? `a${l.account_id}` : `l${l.id}`
    let g = groups.find((g) => g.key === key)
    if (!g) groups.push((g = { key, name: accounts.find((a) => a.id === l.account_id)?.name ?? l.name, loans: [] }))
    g.loans.push(l)
  }
  for (const g of groups) g.loans.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

  // The first future month whose total differs from this month's.
  const after = i >= 0 ? schedule.slice(i + 1) : schedule.filter((r) => r.month > month)
  const next = after.find((r) => monthTotal(r) !== total)
  const delta = next ? monthTotal(next) - total : 0
  const owed = loans.reduce((s, l) => s + l.balance_now, 0)

  const row = (l: LoanView, sub = false) => (
    <Group key={l.id} justify="space-between" wrap="nowrap" gap="xs" pl={sub ? "md" : 0}>
      <Group gap={8} wrap="nowrap" miw={0}>
        <Box w={8} h={8} style={{ borderRadius: 2, flex: "none", background: loanColor(loans.indexOf(l)) }} aria-hidden />
        <Text fz="sm" c={sub ? "dimmed" : undefined} truncate>
          {l.name}
        </Text>
      </Group>
      <Text className="num" fz="sm" c={sub ? "dimmed" : undefined}>
        {money(pay(l))}
      </Text>
    </Group>
  )

  return (
    <Paper p="lg" radius="md" bg="var(--wealth-paper-2)" h="100%">
      <Text fz="xs" c="dimmed" lts=".08em">
        {T`${fmtDate(month)} 要繳`}
      </Text>
      <Text className="num" fz={{ base: 32, sm: 40 }} lh={1.15} mt={4}>
        {money(total)}
      </Text>

      {groups.length > 0 ? (
        <Stack gap={6} mt="md" component="ul" p={0} m={0} style={{ listStyle: "none" }} aria-label={t("本月各筆月付")}>
          {groups.map((g) =>
            g.loans.length < 2 ? (
              <li key={g.key}>{row(g.loans[0])}</li>
            ) : (
              <li key={g.key}>
                <Group justify="space-between" wrap="nowrap" gap="xs">
                  <Text fz="sm" fw={600} truncate>
                    {g.name}
                  </Text>
                  <Text className="num" fz="sm" fw={600}>
                    {money(g.loans.reduce((s, l) => s + pay(l), 0))}
                  </Text>
                </Group>
                <Stack gap={4} mt={4}>
                  {g.loans.map((l) => row(l, true))}
                </Stack>
              </li>
            ),
          )}
        </Stack>
      ) : (
        <Text fz="sm" c="dimmed" mt="md">
          {t("這個月沒有要繳的貸款。")}
        </Text>
      )}

      <Divider my="md" color="var(--wealth-rule)" />
      <Stack gap={6}>
        {next ? (
          <Group gap={8} wrap="wrap">
            <Text fz="sm">{T`${fmtDate(next.month)} 起每月 ${money(monthTotal(next))}`}</Text>
            <Badge
              variant="outline"
              color={delta > 0 ? "var(--wealth-down)" : "var(--wealth-up)"}
              leftSection={delta > 0 ? <TrendingUp size={12} aria-hidden /> : <TrendingDown size={12} aria-hidden />}
            >
              {money(delta, { signed: true })}
            </Badge>
          </Group>
        ) : (
          <Text fz="sm" c="dimmed">
            {t("之後月付都不會再變。")}
          </Text>
        )}
        <Group justify="space-between" gap="xs">
          <Text fz="xs" c="dimmed">
            {t("所有貸款剩餘本金")}
          </Text>
          <Text className="num" fz="sm">
            {money(owed)}
          </Text>
        </Group>
      </Stack>
    </Paper>
  )
}
