import { useEffect, useRef } from "react"
import { ActionIcon, Group, Menu, Stack } from "@mantine/core"
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, EllipsisVertical } from "lucide-react"
import { T, t } from "../../i18n"

type Props = { name: string; index: number; count: number; busy: boolean; onMove: (to: number) => void; stacked?: boolean }

/**
 * Up / down one step, plus "to top" / "to bottom" in a menu, so the tenth account is one move from the top.
 * Keyboard reordering keeps focus: a move in flight is ignored rather than disabling the buttons (which drops
 * focus to <body>), and once the row lands the arrow that was pressed is focused again, or the other one if the
 * row reached the end.
 */
export function MoveButtons({ name, index, count, busy, onMove, stacked }: Props) {
  const first = index === 0, last = index === count - 1
  const Steps = stacked ? Stack : Group
  const upRef = useRef<HTMLButtonElement>(null)
  const downRef = useRef<HTMLButtonElement>(null)
  const pressed = useRef<"up" | "down" | null>(null)
  useEffect(() => {
    if (!pressed.current) return
    const want = pressed.current === "up" ? (first ? downRef : upRef) : last ? upRef : downRef
    pressed.current = null
    want.current?.focus()
  }, [index, first, last])
  const step = (dir: "up" | "down") => {
    if (busy) return
    pressed.current = dir
    onMove(dir === "up" ? index - 1 : index + 1)
  }
  return (
    <Group gap={2} wrap="nowrap">
      <Steps gap={stacked ? 4 : 2}>
        <ActionIcon ref={upRef} size="md" disabled={first} aria-disabled={busy || undefined} aria-label={T`把「${name}」往上移`} onClick={() => step("up")}>
          <ArrowUp size={14} />
        </ActionIcon>
        <ActionIcon ref={downRef} size="md" disabled={last} aria-disabled={busy || undefined} aria-label={T`把「${name}」往下移`} onClick={() => step("down")}>
          <ArrowDown size={14} />
        </ActionIcon>
      </Steps>
      {count > 2 && (
        <Menu position="bottom-end">
          <Menu.Target>
            <ActionIcon size="md" aria-disabled={busy || undefined} aria-label={T`移動「${name}」`}>
              <EllipsisVertical size={14} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<ArrowUpToLine size={14} />} disabled={first || busy} onClick={() => onMove(0)}>
              {t("移到最上面")}
            </Menu.Item>
            <Menu.Item leftSection={<ArrowDownToLine size={14} />} disabled={last || busy} onClick={() => onMove(count - 1)}>
              {t("移到最下面")}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      )}
    </Group>
  )
}
