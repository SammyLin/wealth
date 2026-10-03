import { useState, type KeyboardEvent } from "react"
import { ActionIcon, Button, Group, NumberInput, Table, Text, TextInput, Title, Tooltip, VisuallyHidden } from "@mantine/core"
import { modals } from "@mantine/modals"
import { notifications } from "@mantine/notifications"
import { Check, Save, Trash2 } from "lucide-react"
import { useLedgerState, useMoney } from "../../api/useLedger"
import type { Account, Point } from "../../api/types"
import { T, t } from "../../i18n"
import { fmtDate, fmtInput, parseAmount } from "../../lib/format"

const PAGE = 12

/** Every recorded balance of one account, newest first; each row saves or deletes on its own. */
export function HistoryTable({ account }: { account: Account }) {
  const { state } = useLedgerState()
  const [all, setAll] = useState(false)
  const rows = [...account.history].reverse()
  const foreign = account.currency !== state.settings.base_currency || account.history.some((p) => p.fx !== 1)

  return (
    <>
      <Group justify="space-between" align="baseline" mt="xl" mb="xs">
        <Title order={4} fz="md">
          {t("歷史紀錄")}
        </Title>
        <Text fz="xs" c="dimmed">
          {T`${rows.length} 筆 · 改完按該列的儲存`}
        </Text>
      </Group>
      {rows.length === 0 ? (
        <Text fz="sm" c="dimmed" py="sm">
          {t("還沒有紀錄。到「記一筆」填第一筆餘額。")}
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={foreign ? 440 : 330}>
          <Table verticalSpacing={4} horizontalSpacing="xs" fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t("日期")}</Table.Th>
                <Table.Th>{T`餘額(${account.currency})`}</Table.Th>
                {foreign && <Table.Th>{t("匯率")}</Table.Th>}
                <Table.Th ta="right">{T`價值(${state.settings.base_currency})`}</Table.Th>
                <Table.Th w={64}>
                  <VisuallyHidden>{t("動作")}</VisuallyHidden>
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(all ? rows : rows.slice(0, PAGE)).map((p) => (
                <HistoryRow key={`${p.date}|${p.amount}|${p.fx}`} account={account} point={p} foreign={foreign} />
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      {rows.length > PAGE && (
        <Button variant="subtle" size="compact-sm" mt="xs" onClick={() => setAll(!all)}>
          {all ? t("只顯示最近的") : T`顯示全部 ${rows.length} 筆`}
        </Button>
      )}
    </>
  )
}

function HistoryRow({ account, point, foreign }: { account: Account; point: Point; foreign: boolean }) {
  const { saveSnapshots, deleteSnapshot } = useLedgerState()
  const money = useMoney()
  const [amountText, setAmountText] = useState(fmtInput(point.amount))
  const [fx, setFx] = useState<number | string>(point.fx)
  const [saving, setSaving] = useState(false)
  const amount = parseAmount(amountText)
  const rate = typeof fx === "number" ? fx : Number(fx)
  const valid = !Number.isNaN(amount) && rate > 0
  const dirty = valid && (amount !== point.amount || rate !== point.fx)
  const day = fmtDate(point.date)

  const save = async () => {
    if (!dirty) return
    setSaving(true)
    try {
      await saveSnapshots([{ account_id: account.id, date: point.date, amount, fx: rate }])
      notifications.show({ message: T`已更新 ${day} 的紀錄`, icon: <Check size={16} /> })
    } catch {
      setSaving(false) // on success the row remounts with the saved values
    }
  }

  const remove = () =>
    modals.openConfirmModal({
      title: T`刪除 ${day} 這筆紀錄?`,
      children: <Text fz="sm">{t("趨勢圖會改用前一筆餘額接續。")}</Text>,
      labels: { confirm: t("刪除"), cancel: t("取消") },
      confirmProps: { color: "red" },
      onConfirm: () => deleteSnapshot(account.id, point.date).catch(() => {}),
    })

  const onEnter = (e: KeyboardEvent) => {
    if (e.key === "Enter") void save()
  }

  return (
    <Table.Tr>
      <Table.Td className="num" style={{ whiteSpace: "nowrap" }}>
        <time dateTime={point.date}>{day}</time>
      </Table.Td>
      <Table.Td>
        <TextInput
          size="xs"
          inputMode="decimal"
          classNames={{ input: "num" }}
          aria-label={T`${day} 餘額`}
          value={amountText}
          error={Number.isNaN(amount) ? t("看不懂這個數字") : undefined}
          onChange={(e) => setAmountText(e.currentTarget.value)}
          onKeyDown={onEnter}
          miw={96}
        />
      </Table.Td>
      {foreign && (
        <Table.Td>
          <NumberInput
            size="xs"
            hideControls
            min={0}
            decimalScale={6}
            thousandSeparator={false}
            classNames={{ input: "num" }}
            aria-label={T`${day} 匯率`}
            value={fx}
            error={rate > 0 ? undefined : t("匯率要大於 0")}
            onChange={setFx}
            onKeyDown={onEnter}
            miw={72}
          />
        </Table.Td>
      )}
      <Table.Td ta="right" className="num" style={{ whiteSpace: "nowrap" }}>
        {valid ? money(amount * rate) : "—"}
      </Table.Td>
      <Table.Td>
        <Group gap={0} wrap="nowrap">
          <Tooltip label={t("儲存這列")}>
            <ActionIcon color="gold" variant={dirty ? "light" : "subtle"} disabled={!dirty} loading={saving} aria-label={T`儲存 ${day} 這筆`} onClick={save}>
              <Save size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("刪除這列")}>
            <ActionIcon color="red" aria-label={T`刪除 ${day} 這筆`} onClick={remove}>
              <Trash2 size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Table.Td>
    </Table.Tr>
  )
}
