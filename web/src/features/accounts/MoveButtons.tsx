import { ActionIcon, Group, Menu, Stack } from "@mantine/core"
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, EllipsisVertical } from "lucide-react"
import { T, t } from "../../i18n"

type Props = { name: string; index: number; count: number; busy: boolean; onMove: (to: number) => void; stacked?: boolean }

/** Up / down one step, plus "to top" / "to bottom" in a menu, so the tenth account is one move from the top. */
export function MoveButtons({ name, index, count, busy, onMove, stacked }: Props) {
  const first = index === 0, last = index === count - 1
  const Steps = stacked ? Stack : Group
  return (
    <Group gap={2} wrap="nowrap">
      <Steps gap={stacked ? 4 : 2}>
        <ActionIcon size="md" disabled={first || busy} aria-label={T`把「${name}」往上移`} onClick={() => onMove(index - 1)}>
          <ArrowUp size={14} />
        </ActionIcon>
        <ActionIcon size="md" disabled={last || busy} aria-label={T`把「${name}」往下移`} onClick={() => onMove(index + 1)}>
          <ArrowDown size={14} />
        </ActionIcon>
      </Steps>
      {count > 2 && (
        <Menu position="bottom-end">
          <Menu.Target>
            <ActionIcon size="md" disabled={busy} aria-label={T`移動「${name}」`}>
              <EllipsisVertical size={14} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<ArrowUpToLine size={14} />} disabled={first} onClick={() => onMove(0)}>
              {t("移到最上面")}
            </Menu.Item>
            <Menu.Item leftSection={<ArrowDownToLine size={14} />} disabled={last} onClick={() => onMove(count - 1)}>
              {t("移到最下面")}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      )}
    </Group>
  )
}
