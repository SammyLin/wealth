import { useMemo, useState } from "react"
import { useDisclosure } from "@mantine/hooks"
import { ActionIcon, Button, EmptyState, Group, Text, Timeline, Tooltip } from "@mantine/core"
import { notifications } from "@mantine/notifications"
import { Flag, Pencil, Plus, Trash2 } from "lucide-react"
import type { Event } from "../../api/types"
import { useLedgerState, useMoney } from "../../api/useLedger"
import { T, t } from "../../i18n"
import { fmtDate } from "../../lib/format"
import { askConfirm } from "../../shell/confirm"
import { SectionCard } from "../../shell/SectionCard"
import { EventModal } from "./EventModal"

export function Events() {
  const { state, deleteEvent } = useLedgerState()
  const money = useMoney()
  // `editing` outlives `opened` so the modal keeps its title through the close transition.
  const [opened, { open, close }] = useDisclosure(false)
  const [editing, setEditing] = useState<Event | null>(null)
  const edit = (e: Event | null) => (setEditing(e), open())

  // Newest first, each with the net worth on record at that date (series is ascending by date).
  const items = useMemo(() => {
    const series = state.series
    return [...state.events]
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
      .map((e) => ({ ...e, worth: series.findLast((r) => r.date <= e.date)?.total }))
  }, [state.events, state.series])

  const confirmDelete = (e: Event) =>
    askConfirm({
      title: t("刪除這件大事?"),
      body: (
        <>
          <span className="num">{fmtDate(e.date)}</span> {e.title}
        </>
      ),
      confirm: t("刪除"),
      danger: true,
      onConfirm: () =>
        deleteEvent(e.id).then(
          () => notifications.show({ icon: <Trash2 size={16} />, message: T`已刪除「${e.title}」` }),
          () => {}, // failure already notified by useLedger
        ),
    })

  const add = (
    <Button variant="default" leftSection={<Plus size={16} />} onClick={() => edit(null)}>
      {t("新增大事")}
    </Button>
  )

  return (
    <SectionCard title={t("大事記")} description={t("買房、換工作、年終這類轉折,會畫在趨勢圖上。")} actions={add}>
      {!items.length ? (
        <EmptyState
          variant="light"
          icon={<Flag size={24} />}
          title={t("還沒有大事")}
          description={t("像「買房」這種會讓曲線轉彎的事,記下來會在趨勢圖上畫成一條參考線,回頭看更清楚。")}
        />
      ) : (
        <Timeline active={0} bulletSize={14} lineWidth={2} aria-label={t("大事記,由新到舊")}>
          {items.map((e) => (
            <Timeline.Item
              key={e.id}
              title={
                <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
                  <Text fw={600} style={{ overflowWrap: "anywhere" }}>
                    {e.title}
                  </Text>
                  <Group gap={2} wrap="nowrap">
                    <Tooltip label={t("編輯")}>
                      <ActionIcon size="lg" variant="subtle" color="gray" aria-label={T`編輯 ${e.title}`} onClick={() => edit(e)}>
                        <Pencil size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label={t("刪除")}>
                      <ActionIcon size="lg" variant="subtle" color="down" aria-label={T`刪除 ${e.title}`} onClick={() => confirmDelete(e)}>
                        <Trash2 size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Group>
              }
            >
              <Group gap="xs" c="dimmed" fz="sm">
                <time className="num" dateTime={e.date}>
                  {fmtDate(e.date)}
                </time>
                {e.worth != null && (
                  <Text span fz="sm" c="dimmed">
                    · {t("當時淨資產")} <span className="num">{money(e.worth)}</span>
                  </Text>
                )}
              </Group>
            </Timeline.Item>
          ))}
        </Timeline>
      )}
      <EventModal opened={opened} onClose={close} event={editing} />
    </SectionCard>
  )
}

export default Events
