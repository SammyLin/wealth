import { useState } from "react"
import { ActionIcon, Button, Card, Collapse, ColorInput, Group, Paper, Select, Skeleton, Stack, Text, TextInput, Tooltip } from "@mantine/core"
import { modals } from "@mantine/modals"
import { notifications } from "@mantine/notifications"
import { ArrowDown, ArrowUp, Check, Plus, Trash2 } from "lucide-react"
import { useLedger, useLedgerState } from "../../api/useLedger"
import type { Kind, KindInput, Liquidity } from "../../api/types"
import { T, t } from "../../i18n"
import { KindForm } from "./KindForm"
import { LIQUIDITY, moved, SWATCHES } from "./logic"

const HEX = /^#[0-9a-f]{6}$/i

/** Account classes: color, name, liquidity tier and order. Changes save as soon as a field is left. */
export function KindsManager() {
  const { state } = useLedger()
  return state ? <KindList /> : <Skeleton h={160} />
}

function KindList() {
  const { state, reorderKinds } = useLedgerState()
  const [adding, setAdding] = useState(false)
  const [moving, setMoving] = useState(false)

  // One request renumbers every kind's sort to its new position.
  const move = async (i: number, delta: -1 | 1) => {
    setMoving(true)
    try {
      await reorderKinds(moved(state.kinds, i, delta).map((k) => k.key))
    } catch {
      /* useLedger already showed the error */
    } finally {
      setMoving(false)
    }
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" gap="sm">
        <Text fz="sm" c="dimmed" maw={420}>
          {t("類別決定帳戶的顏色,以及在資產負債表裡算哪一層;流動性選「負債」的類別會從淨資產扣掉。")}
        </Text>
        {!adding && (
          <Button variant="light" leftSection={<Plus size={16} />} onClick={() => setAdding(true)}>
            {t("新增類別")}
          </Button>
        )}
      </Group>
      <Collapse expanded={adding}>
        <Card withBorder shadow="none" bg="var(--wealth-paper)">
          {adding && <KindForm onDone={() => setAdding(false)} />}
        </Card>
      </Collapse>
      <Stack gap="xs">
        {state.kinds.map((k, i) => (
          <KindRow key={`${k.key}|${k.name}|${k.color}|${k.liquidity}|${t(k.name)}`} kind={k} first={i === 0} last={i === state.kinds.length - 1} moving={moving} onMove={(d) => move(i, d)} />
        ))}
      </Stack>
    </Stack>
  )
}

type RowProps = { kind: Kind; first: boolean; last: boolean; moving: boolean; onMove: (delta: -1 | 1) => void }

function KindRow({ kind, first, last, moving, onMove }: RowProps) {
  const { state, updateKind, deleteKind } = useLedgerState()
  // Seeded names (銀行…) are shown translated, like everywhere else; leaving the text as shown keeps the stored name.
  const label = t(kind.name)
  const [name, setName] = useState(label)
  const [color, setColor] = useState(kind.color)
  const used = state.accounts.filter((a) => a.kind === kind.key).length

  const commit = async (patch: Partial<KindInput>) => {
    const typed = name.trim()
    const next: KindInput = { name: typed === label ? kind.name : typed, color, liquidity: kind.liquidity, sort: kind.sort, ...patch }
    if (!next.name || !HEX.test(next.color)) return (setName(label), setColor(kind.color))
    if (next.name === kind.name && next.color.toLowerCase() === kind.color.toLowerCase() && next.liquidity === kind.liquidity) return
    try {
      await updateKind(kind.key, next)
    } catch {
      setName(label)
      setColor(kind.color)
    }
  }

  // Moving a kind into or out of "liability" flips the sign of its whole history, so ask first.
  const changeLiquidity = (v: Liquidity) => {
    if ((v === "liability") === (kind.liquidity === "liability")) return void commit({ liquidity: v })
    modals.openConfirmModal({
      title: v === "liability" ? T`把「${label}」改成負債?` : T`把「${label}」改成資產?`,
      children: (
        <Text fz="sm">
          {v === "liability"
            ? T`這個類別的 ${used} 個帳戶會從淨資產扣掉,所有歷史的淨資產都會重算。`
            : T`這個類別的 ${used} 個帳戶會算進資產,所有歷史的淨資產都會重算。`}
        </Text>
      ),
      labels: { confirm: t("確定修改"), cancel: t("取消") },
      onConfirm: () => void commit({ liquidity: v }),
    })
  }

  const remove = () => {
    if (used > 0) {
      // Same rule and wording as the server's 409, shown before the request so it reads in the UI language.
      notifications.show({ color: "red", title: T`不能刪除「${label}」`, message: T`還有 ${used} 個帳戶使用這個類別,請先改到別的類別` })
      return
    }
    modals.openConfirmModal({
      title: T`刪除類別「${label}」?`,
      children: <Text fz="sm">{t("沒有帳戶使用這個類別,刪除後可以再新增。")}</Text>,
      labels: { confirm: t("刪除"), cancel: t("取消") },
      confirmProps: { color: "red" },
      onConfirm: () =>
        deleteKind(kind.key).then(
          () => notifications.show({ message: T`已刪除類別「${label}」`, icon: <Check size={16} /> }),
          () => {},
        ),
    })
  }

  return (
    <Paper withBorder p="xs" radius="md">
      <Group gap="xs" wrap="wrap" align="center">
        <ColorInput
          aria-label={T`${label} 的顏色`}
          value={color}
          onChange={setColor}
          onChangeEnd={(c) => commit({ color: c })}
          onBlur={() => commit({})}
          swatches={SWATCHES}
          swatchesPerRow={10}
          withEyeDropper={false}
          w={118}
          classNames={{ input: "num" }}
        />
        <TextInput
          aria-label={T`${label} 的名稱`}
          value={name}
          maxLength={30}
          onChange={(e) => setName(e.currentTarget.value)}
          onBlur={() => commit({})}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          style={{ flex: "1 1 140px" }}
        />
        <Select
          aria-label={T`${label} 的流動性`}
          data={LIQUIDITY.map((l) => ({ value: l.value, label: t(l.label) }))}
          value={kind.liquidity}
          allowDeselect={false}
          onChange={(v) => v && changeLiquidity(v as Liquidity)}
          style={{ flex: "1 1 150px" }}
        />
        <Group gap={2} wrap="nowrap" ml="auto">
          <Text fz="xs" c="dimmed" mr={4} style={{ whiteSpace: "nowrap" }}>
            {T`${used} 個帳戶使用`}
          </Text>
          <ActionIcon disabled={first || moving} aria-label={T`把「${label}」往上移`} onClick={() => onMove(-1)}>
            <ArrowUp size={16} />
          </ActionIcon>
          <ActionIcon disabled={last || moving} aria-label={T`把「${label}」往下移`} onClick={() => onMove(1)}>
            <ArrowDown size={16} />
          </ActionIcon>
          <Tooltip label={used ? t("還有帳戶使用,不能刪除") : t("刪除類別")}>
            {/* data-disabled looks disabled but stays focusable, so the tooltip and the reason still reach keyboard users */}
            <ActionIcon color="red" data-disabled={used > 0 || undefined} aria-disabled={used > 0} aria-label={T`刪除類別「${label}」`} onClick={remove}>
              <Trash2 size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
    </Paper>
  )
}
