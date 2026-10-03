import { ActionIcon, Badge, Box, Group, Paper, Progress, SimpleGrid, Stack, Text, Tooltip } from "@mantine/core"
import { Stat } from "../../shell/Stat"
import { CalendarClock, Link2, Pencil, Trash2 } from "lucide-react"
import type { LoanView } from "../../api/types"
import { useMoney } from "../../api/useLedger"
import { T, t } from "../../i18n"
import { fmtDate, fmtPct } from "../../lib/format"
import { fmtRate, fmtTerm } from "./labels"
import { loanColor, loanStatus, nextChange, type LoanStatus } from "./math"

const STATUS: Record<LoanStatus, { label: string; color: string }> = {
  pending: { label: "尚未開始", color: "gray" },
  grace: { label: "寬限期中", color: "gold" },
  repaying: { label: "還本中", color: "up" },
  paid: { label: "已繳清", color: "gray" },
}

type Props = { loan: LoanView; index: number; account?: string; today: string; onEdit: () => void; onDelete: () => void }

export function LoanCard({ loan: l, index, account, today, onEdit, onDelete }: Props) {
  const money = useMoney()
  const status = loanStatus(l, today)
  const next = nextChange(l, today)
  const paid = l.principal > 0 ? 1 - l.balance_now / l.principal : 0
  const jump = next && next.kind !== "payoff" ? next : null

  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
        <Box miw={0}>
          {/* the name wraps instead of truncating ("房貸 A…" at 390px), and the badge drops under it when they don't fit */}
          <Group gap={8} wrap="wrap" style={{ rowGap: 4 }}>
            <Group gap={8} wrap="nowrap" miw={0}>
              <Box w={10} h={10} style={{ borderRadius: 3, flex: "none", background: loanColor(index) }} aria-hidden />
              <Text fw={600} style={{ overflowWrap: "anywhere" }}>
                {l.name}
              </Text>
            </Group>
            <Badge size="md" variant="outline" color={STATUS[status].color} style={{ flex: "none" }}>
              {t(STATUS[status].label)}
            </Badge>
          </Group>
          <Group gap={4} mt={4} c="dimmed" wrap="nowrap">
            <Link2 size={13} aria-hidden style={{ flex: "none" }} />
            <Text fz="xs" truncate>
              {account ?? t("未連結負債帳戶")}
            </Text>
          </Group>
        </Box>
        <Group gap={2} wrap="nowrap">
          <Tooltip label={t("編輯")}>
            <ActionIcon aria-label={T`編輯 ${l.name}`} onClick={onEdit}>
              <Pencil size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("刪除")}>
            <ActionIcon aria-label={T`刪除 ${l.name}`} color="down" onClick={onDelete}>
              <Trash2 size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <Text fz="xs" c="dimmed" mt={6}>
        {T`年利率 ${fmtRate(l.rate)} · ${fmtTerm(l.total_months)} · ${fmtDate(l.start)} 撥款`}
      </Text>

      <SimpleGrid cols={2} spacing="sm" verticalSpacing="sm" mt="md">
        <Stat label={t("剩餘本金")} value={money(l.balance_now)} />
        <Stat label={t("本月月付")} value={money(l.payment_now)} />
        <Stat label={t("寬限期結束")} value={l.grace_months > 0 ? fmtDate(l.grace_end) : "—"} />
        <Stat label={t("繳清日")} value={fmtDate(l.end_date)} />
      </SimpleGrid>

      <Stack gap={4} mt="md">
        <Progress value={paid * 100} size="sm" color="gold" aria-label={T`已還本金 ${fmtPct(paid)}`} />
        <Text fz="xs" c="dimmed">
          {T`已還 ${fmtPct(paid)} · 本金 ${money(l.principal)}`}
        </Text>
      </Stack>

      {jump && (
        <Group gap={8} mt="sm" wrap="nowrap" align="flex-start" p="xs" bg="var(--wealth-paper-2)" style={{ borderRadius: "var(--mantine-radius-sm)" }}>
          <CalendarClock size={16} aria-hidden style={{ flex: "none", marginTop: 2 }} />
          <Text fz="sm">
            {jump.kind === "grace"
              ? T`${fmtDate(jump.date)} 寬限期結束,月付 ${money(l.payment_now)} → ${money(jump.amount)}`
              : T`${fmtDate(jump.date)} 開始繳,月付 ${money(jump.amount)}`}
          </Text>
        </Group>
      )}
    </Paper>
  )
}
