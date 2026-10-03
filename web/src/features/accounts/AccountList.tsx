import { useState } from "react"
import { Accordion, Box, Button, Card, Collapse, ColorSwatch, Divider, EmptyState, Group, Stack, Text } from "@mantine/core"
import { Archive, PenLine, Plus, WalletCards } from "lucide-react"
import { useLedgerState, useMoney } from "../../api/useLedger"
import type { Account } from "../../api/types"
import { T, t } from "../../i18n"
import { useOpenDialog } from "../../shell/dialogs"
import { AccountForm } from "./AccountForm"
import { HistoryTable } from "./HistoryTable"
import { moved } from "./logic"
import { MoveButtons } from "./MoveButtons"

/** Accounts as an accordion: the row summarizes, the panel edits the account and its history. */
export function AccountList({ initialOpen }: { initialOpen?: number }) {
  const { state, reorderAccounts } = useLedgerState()
  const openDialog = useOpenDialog()
  const [open, setOpen] = useState<string | null>(initialOpen ? String(initialOpen) : null)
  const [adding, setAdding] = useState(!state.accounts.length)
  const [moving, setMoving] = useState(false)
  const active = state.accounts.filter((a) => !a.archived)
  const archived = state.accounts.filter((a) => a.archived)

  const move = async (i: number, to: number) => {
    setMoving(true)
    try {
      await reorderAccounts([...moved(active, i, to), ...archived].map((a) => a.id))
    } catch {
      /* useLedger already showed the error */
    } finally {
      setMoving(false)
    }
  }

  const item = (a: Account, i: number) => (
    <AccountItem key={a.id} account={a} opened={open === String(a.id)} moving={moving} onMove={a.archived ? undefined : (to) => move(i, to)} index={i} count={active.length} />
  )

  return (
    <Stack gap="md">
      <Group justify="space-between" gap="sm">
        <Text fz="sm" c="dimmed">
          {T`${active.length} 個帳戶`}
        </Text>
        <Group gap="xs">
          {active.some((a) => !a.history.length) && (
            <Button variant="filled" leftSection={<PenLine size={16} />} onClick={() => openDialog("record")}>
              {t("記下第一筆餘額")}
            </Button>
          )}
          {!adding && (
            <Button variant="light" leftSection={<Plus size={16} />} onClick={() => setAdding(true)}>
              {t("新增帳戶")}
            </Button>
          )}
        </Group>
      </Group>

      <Collapse expanded={adding}>
        <Card withBorder shadow="none" bg="var(--wealth-paper)">
          <Text ff="heading" fw={600} mb="sm">
            {t("新增帳戶")}
          </Text>
          {adding && <AccountForm onDone={() => setAdding(false)} />}
        </Card>
      </Collapse>

      {state.accounts.length === 0 ? (
        <EmptyState
          variant="light"
          icon={<WalletCards size={24} />}
          title={t("還沒有帳戶")}
          description={t("銀行、證券戶、房子、車、房貸,各建一個帳戶。之後每次只要更新餘額。")}
        />
      ) : (
        <Accordion value={open} onChange={setOpen} variant="contained" chevronPosition="left">
          {active.map(item)}
          {archived.length > 0 && (
            <Divider
              my="sm"
              labelPosition="left"
              label={
                <Group gap={6}>
                  <Archive size={14} />
                  {T`已封存 ${archived.length} 個帳戶`}
                </Group>
              }
            />
          )}
          {archived.map(item)}
        </Accordion>
      )}
    </Stack>
  )
}

type ItemProps = { account: Account; opened: boolean; moving: boolean; index: number; count: number; onMove?: (to: number) => void }

function AccountItem({ account: a, opened, moving, index, count, onMove }: ItemProps) {
  const { state } = useLedgerState()
  const money = useMoney()
  const kind = state.kinds.find((k) => k.key === a.kind)
  const latest = a.history.at(-1)
  const foreign = a.currency !== state.settings.base_currency

  return (
    <Accordion.Item value={String(a.id)}>
      <Box style={{ display: "flex", alignItems: "center" }} pr={onMove ? 6 : 0}>
        <Accordion.Control px="sm">
          <Group justify="space-between" wrap="nowrap" gap="sm">
            <Group gap="sm" wrap="nowrap" miw={0}>
              <ColorSwatch size={10} color={kind?.color ?? "gray"} withShadow={false} style={{ flexShrink: 0 }} />
              <Box miw={0}>
                <Text fw={500} truncate c={a.archived ? "dimmed" : undefined}>
                  {a.name}
                </Text>
                <Text fz="xs" c="dimmed" truncate>
                  {[kind ? t(kind.name) : a.kind, a.currency, a.note].filter(Boolean).join(" · ")}
                </Text>
              </Box>
            </Group>
            <Box ta="right" style={{ flexShrink: 0 }}>
              <Text className="num" fz="sm">
                {latest ? money(latest.value) : t("尚未記錄")}
              </Text>
              {latest && foreign && (
                <Text className="num" fz="xs" c="dimmed">
                  {money(latest.amount)} {a.currency}
                </Text>
              )}
            </Box>
          </Group>
        </Accordion.Control>
        {onMove && <MoveButtons name={a.name} index={index} count={count} busy={moving} onMove={onMove} stacked />}
      </Box>
      <Accordion.Panel>
        {opened && (
          <>
            <AccountForm account={a} />
            <HistoryTable account={a} />
          </>
        )}
      </Accordion.Panel>
    </Accordion.Item>
  )
}
