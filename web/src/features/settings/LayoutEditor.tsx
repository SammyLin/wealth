import { useRef, useState } from "react"
import { ActionIcon, Button, Group, Paper, Stack, Switch, Text } from "@mantine/core"
import { ChevronDown, ChevronUp, RotateCcw } from "lucide-react"
import type { Layout, SectionId } from "../../api/types"
import { T, t } from "../../i18n"
import { SECTIONS, useLayout } from "../../shell/sections"

type Entry = Layout["sections"][number]
const DEFAULT: Entry[] = SECTIONS.map((s) => ({ id: s.id, hidden: false }))
const label = (id: SectionId) => t(SECTIONS.find((s) => s.id === id)!.label)

/** Reorder and show/hide dashboard sections; saved to settings.layout through useLayout(). */
export function LayoutEditor() {
  const { sections, save } = useLayout()
  // Optimistic copy so moves feel instant; dropped once the save (and state refresh) settles, or on failure.
  // Saves run one after another so quick clicks can't land out of order.
  const [draft, setDraft] = useState<Entry[] | null>(null)
  const queue = useRef<{ tail: Promise<unknown>; seq: number }>({ tail: Promise.resolve(), seq: 0 })
  const list = draft ?? sections

  const commit = (next: Entry[]) => {
    const q = queue.current
    const seq = ++q.seq
    setDraft(next)
    q.tail = q.tail
      .then(() => save(next))
      .catch(() => {
        /* useLedger already showed the error; the list falls back to what is saved */
      })
      .finally(() => {
        if (seq === q.seq) setDraft(null)
      })
  }
  const move = (i: number, d: -1 | 1) => {
    const next = [...list]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    commit(next)
  }
  const toggle = (id: SectionId) => commit(list.map((s) => (s.id === id ? { ...s, hidden: !s.hidden } : s)))
  const isDefault = JSON.stringify(list) === JSON.stringify(DEFAULT)

  return (
    <Stack gap="xs">
      <Stack gap={6} component="ol" m={0} p={0} style={{ listStyle: "none" }} aria-label={t("首頁區塊順序")}>
        {list.map((s, i) => (
          <Paper key={s.id} component="li" withBorder px="sm" py={8} radius="md" bg={s.hidden ? "var(--wealth-paper-2)" : undefined}>
            <Group gap="xs" wrap="nowrap">
              <Text className="num" fs="italic" c="gold" fz="sm" w={22} aria-hidden>
                {String(i + 1).padStart(2, "0")}
              </Text>
              <Text flex={1} miw={0} truncate fz="sm" c={s.hidden ? "dimmed" : undefined} td={s.hidden ? "line-through" : undefined}>
                {label(s.id)}
              </Text>
              <ActionIcon size="md" disabled={i === 0} onClick={() => move(i, -1)} aria-label={T`${label(s.id)} 上移`}>
                <ChevronUp size={16} />
              </ActionIcon>
              <ActionIcon size="md" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label={T`${label(s.id)} 下移`}>
                <ChevronDown size={16} />
              </ActionIcon>
              <Switch
                size="sm"
                checked={!s.hidden}
                onChange={() => toggle(s.id)}
                aria-label={T`顯示 ${label(s.id)}`}
                ml={4}
              />
            </Group>
          </Paper>
        ))}
      </Stack>
      <Group justify="flex-end">
        <Button variant="subtle" color="gray" size="compact-sm" leftSection={<RotateCcw size={14} />} disabled={isDefault} onClick={() => commit(DEFAULT)}>
          {t("恢復預設")}
        </Button>
      </Group>
    </Stack>
  )
}
