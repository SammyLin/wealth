import { useState, type KeyboardEvent } from "react"
import { ActionIcon, Button, Group, Loader, Table, Text, TextInput, Title, Tooltip, VisuallyHidden } from "@mantine/core"
import { Trash2 } from "lucide-react"
import { useLedgerState, useMoney } from "../../api/useLedger"
import type { Account, Point } from "../../api/types"
import { T, t } from "../../i18n"
import { fmtDate, fmtInput, fxShown, parseAmount, parseFx } from "../../lib/format"
import { askConfirm } from "../../shell/confirm"
import { useDirty } from "../../shell/dirty"
import { notifyUndo } from "../../shell/undo"

const PAGE = 12

/** Every recorded balance of one account, newest first; a row saves itself on Enter or when focus leaves it. */
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
          {T`${rows.length} 筆 · 改完按 Enter 或離開該列就會儲存`}
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
                <Table.Th ta="right">{T`餘額(${account.currency})`}</Table.Th>
                {foreign && <Table.Th ta="right">{t("匯率")}</Table.Th>}
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

// Same look as the record grid: right-aligned figures in the number font, at the table's text size.
const NUM_INPUT = { input: { textAlign: "right", fontFamily: "var(--wealth-font-num)" } } as const

function HistoryRow({ account, point, foreign }: { account: Account; point: Point; foreign: boolean }) {
  const { saveSnapshots, deleteSnapshot } = useLedgerState()
  const money = useMoney()
  const [amountText, setAmountText] = useState(fmtInput(point.amount))
  // Rates at full precision, the same way as the record dialog: VND→USD 0.0000385 has 7 decimals.
  const [fxText, setFxText] = useState(String(point.fx))
  const [fxFocused, setFxFocused] = useState(false)
  const [saving, setSaving] = useState(false)
  const amount = parseAmount(amountText)
  const rate = parseFx(fxText)
  const valid = !Number.isNaN(amount) && rate > 0
  const dirty = valid && (amount !== point.amount || rate !== point.fx)
  const day = fmtDate(point.date)
  // an edit being saved isn't "unsaved"; one that can't be saved (bad number) still guards the dialog's close
  useDirty(!saving && (amountText !== fmtInput(point.amount) || fxText !== String(point.fx)))

  const save = async () => {
    if (!dirty || saving) return
    setSaving(true)
    try {
      await saveSnapshots([{ account_id: account.id, date: point.date, amount, fx: rate }])
      notifyUndo({
        message: T`已更新 ${day} 的紀錄`,
        undo: () => saveSnapshots([{ account_id: account.id, date: point.date, amount: point.amount, fx: point.fx }]),
      })
    } catch {
      setSaving(false) // on success the row remounts with the saved values
    }
  }

  const remove = () =>
    askConfirm({
      title: T`刪除 ${day} 這筆紀錄?`,
      body: t("趨勢圖會改用前一筆餘額接續。"),
      confirm: t("刪除"),
      danger: true,
      onConfirm: () => void deleteSnapshot(account.id, point.date).catch(() => {}),
    })

  const onEnter = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) void save()
  }

  return (
    // focus leaving the row (not moving between its own fields or to its delete button) saves it
    <Table.Tr onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && void save()}>
      <Table.Td className="num" style={{ whiteSpace: "nowrap" }}>
        <time dateTime={point.date}>{day}</time>
      </Table.Td>
      <Table.Td>
        <TextInput
          size="sm"
          inputMode="decimal"
          autoComplete="off"
          styles={NUM_INPUT}
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
          <TextInput
            size="sm"
            inputMode="decimal"
            autoComplete="off"
            styles={NUM_INPUT}
            aria-label={T`${day} 匯率`}
            value={fxShown(fxText, fxFocused)}
            error={rate > 0 ? undefined : t("匯率要大於 0")}
            onChange={(e) => setFxText(e.currentTarget.value)}
            onFocus={() => setFxFocused(true)}
            onBlur={() => setFxFocused(false)}
            onKeyDown={onEnter}
            miw={88}
          />
        </Table.Td>
      )}
      <Table.Td ta="right" className="num" style={{ whiteSpace: "nowrap" }}>
        {valid ? money(amount * rate) : "—"}
      </Table.Td>
      <Table.Td>
        <Group gap={0} wrap="nowrap" justify="flex-end">
          {saving && <Loader size={14} mx={6} aria-label={t("儲存中")} />}
          <Tooltip label={t("刪除這列")}>
            <ActionIcon color="down" aria-label={T`刪除 ${day} 這筆`} onClick={remove}>
              <Trash2 size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Table.Td>
    </Table.Tr>
  )
}
