import { useState } from "react"
import { Alert, Button, EmptyState, Grid, Group, SimpleGrid, Stack, Text } from "@mantine/core"
import { notifications } from "@mantine/notifications"
import { Info, Landmark, Plus, TriangleAlert } from "lucide-react"
import type { LoanView } from "../../api/types"
import { useLedgerState, useMoney } from "../../api/useLedger"
import { T, t } from "../../i18n"
import { askConfirm } from "../../shell/confirm"
import { SectionCard } from "../../shell/SectionCard"
import { LoanCard } from "./LoanCard"
import { LoanModal } from "./LoanModal"
import { todayISO } from "../../lib/format"
import { PaymentChart } from "./PaymentChart"
import { ThisMonth } from "./ThisMonth"

export function Loans() {
  const { state, deleteLoan } = useLedgerState()
  const money = useMoney()
  // undefined = closed, null = new loan, LoanView = editing
  const [editing, setEditing] = useState<LoanView | null | undefined>(undefined)
  const today = todayISO()

  const add = (
    <Button variant="default" leftSection={<Plus size={16} />} onClick={() => setEditing(null)}>
      {t("新增貸款")}
    </Button>
  )
  const card = (children: React.ReactNode) => (
    <SectionCard title={t("貸款")} description={t("每個月要繳多少、寬限期什麼時候結束、月付什麼時候會跳。")} actions={state.loans.length ? add : undefined}>
      {children}
    </SectionCard>
  )

  const { loans, loan_schedule: schedule, accounts } = state
  const accountName = (id: number | null) => accounts.find((a) => a.id === id)?.name
  const modal = <LoanModal opened={editing !== undefined} onClose={() => setEditing(undefined)} loan={editing} />

  if (!loans.length)
    return card(
      <>
        <EmptyState
          py="xl"
          variant="light"
          icon={<Landmark size={24} />}
          title={t("還沒有登記貸款")}
          description={t(
            "新增後會算出每月月付、寬限期結束日和月付什麼時候會跳。一筆房貸若分成好幾段(不同利率、撥款日或寬限期),每段各新增一筆並連結到同一個負債帳戶,這裡就會合併成一筆房貸的月付。",
          )}
        >
          <EmptyState.Actions>
            <Group justify="center">
              <Button leftSection={<Plus size={16} />} onClick={() => setEditing(null)}>
                {t("新增第一筆貸款")}
              </Button>
            </Group>
          </EmptyState.Actions>
        </EmptyState>
        {modal}
      </>,
    )

  // A linked liability account owing clearly more than its registered loans: a tranche is probably missing.
  const gaps = accounts.flatMap((a) => {
    const ls = loans.filter((l) => l.account_id === a.id)
    if (!ls.length) return []
    const owed = Math.abs(a.history.at(-1)?.value ?? 0)
    const reg = ls.reduce((s, l) => s + l.balance_now, 0)
    return owed - reg > Math.max(100_000, owed * 0.02) ? [{ a, owed, reg }] : []
  })

  const remove = (l: LoanView) =>
    askConfirm({
      title: T`刪除貸款「${l.name}」?`,
      body: t("只會刪掉這筆貸款的設定(月付計算),帳上的負債餘額不受影響。"),
      confirm: t("刪除"),
      danger: true,
      onConfirm: () =>
        deleteLoan(l.id).then(
          () => notifications.show({ message: T`已刪除「${l.name}」` }),
          () => {}, // useLedger already showed the error
        ),
    })

  return card(
    <Stack gap="lg">
      {gaps.map(({ a, owed, reg }) => (
        <Alert key={a.id} variant="light" color="warn" icon={<TriangleAlert size={18} />}>
          {T`「${a.name}」帳上負債 ${money(owed)},已登記的貸款剩餘本金只有 ${money(reg)},還差 ${money(owed - reg)} 沒登記。補上那一段貸款,月付才會完整。`}
        </Alert>
      ))}

      <Grid gap="lg">
        <Grid.Col span={{ base: 12, md: 5 }}>
          <ThisMonth loans={loans} schedule={schedule} accounts={accounts} today={today} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 7 }}>
          <PaymentChart loans={loans} schedule={schedule} today={today} />
          <Group gap={6} mt="xs" wrap="nowrap" align="flex-start" c="dimmed">
            <Info size={14} aria-hidden style={{ flex: "none", marginTop: 3 }} />
            <Text fz="xs">{t("寬限期只繳利息;之後本息平均攤還。實際金額以銀行通知為準。")}</Text>
          </Group>
        </Grid.Col>
      </Grid>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        {loans.map((l, i) => (
          <LoanCard
            key={l.id}
            loan={l}
            index={i}
            account={accountName(l.account_id)}
            today={today}
            onEdit={() => setEditing(l)}
            onDelete={() => remove(l)}
          />
        ))}
      </SimpleGrid>
      {modal}
    </Stack>,
  )
}

export default Loans
