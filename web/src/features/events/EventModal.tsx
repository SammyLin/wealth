import { useState } from "react"
import { Button, Group, Modal, Stack, Text, TextInput, useMantineTheme } from "@mantine/core"
import { DatePickerInput } from "@mantine/dates"
import { useForm } from "@mantine/form"
import { useMediaQuery } from "@mantine/hooks"
import { notifications } from "@mantine/notifications"
import { CalendarDays, Check, Flag } from "lucide-react"
import type { Event } from "../../api/types"
import { useLedger } from "../../api/useLedger"
import { t, useLang } from "../../i18n"
import { todayISO } from "../../lib/format"

type Props = { opened: boolean; onClose: () => void; event?: Event | null }

/** Add (no `event`) or edit one life event. Full-screen under `sm`. */
export function EventModal({ opened, onClose, event }: Props) {
  const theme = useMantineTheme()
  const mobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`)
  return (
    <Modal opened={opened} onClose={onClose} fullScreen={mobile} title={t(event ? "編輯大事" : "新增大事")}>
      {/* Modal unmounts its body after closing, so the form starts fresh from `event` on every open. */}
      <EventForm event={event} onDone={onClose} mobile={!!mobile} />
    </Modal>
  )
}

function EventForm({ event, onDone, mobile }: { event?: Event | null; onDone: () => void; mobile: boolean }) {
  const { saveEvent } = useLedger()
  const { lang } = useLang()
  const [saving, setSaving] = useState(false)
  const form = useForm({
    initialValues: { date: event?.date ?? todayISO(), title: event?.title ?? "" },
    validate: {
      date: (v) => (v ? null : t("請選日期")),
      title: (v) => (v.trim() ? null : t("請輸入事件名稱")),
    },
  })

  const submit = form.onSubmit(async ({ date, title }) => {
    setSaving(true)
    try {
      await saveEvent({ id: event?.id, date, title: title.trim() })
      notifications.show({ color: "teal", icon: <Check size={16} />, message: t(event ? "已更新" : "已加到大事記") })
      onDone()
    } catch {
      /* useLedger already showed the error; stay open so nothing typed is lost */
    } finally {
      setSaving(false)
    }
  })

  return (
    <form onSubmit={submit} noValidate>
      <Stack gap="md">
        <Text c="dimmed" fz="sm">
          {t("會在趨勢圖上畫一條虛線,方便對照淨資產的轉折。")}
        </Text>
        <DatePickerInput
          label={t("日期")}
          required
          locale={lang === "en" ? "en" : "zh-tw"}
          leftSection={<CalendarDays size={16} />}
          dropdownType={mobile ? "modal" : "popover"}
          {...form.getInputProps("date")}
        />
        <TextInput
          label={t("事件")}
          required
          maxLength={40}
          placeholder={t("例:買房、換工作、年終入帳")}
          data-autofocus
          {...form.getInputProps("title")}
        />
        <Group justify="flex-end" gap="sm" mt="sm">
          <Button variant="default" onClick={onDone}>
            {t("取消")}
          </Button>
          <Button type="submit" loading={saving} leftSection={<Flag size={16} />}>
            {t(event ? "儲存" : "新增")}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}
