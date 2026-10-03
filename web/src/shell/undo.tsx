/* oxlint-disable react/only-export-components -- the toast and its shortcut hook share `latest` */
import { Button, Group, Kbd, Text } from "@mantine/core"
import { useHotkeys } from "@mantine/hooks"
import { notifications, type NotificationData } from "@mantine/notifications"
import { Check, Undo2 } from "lucide-react"
import { t } from "../i18n"

let seq = 0
/** The newest Undo toast still on screen: mod+Z (outside text fields) runs it, so keyboard users needn't Tab into the portal. */
let latest: { id: string; run: () => void } | null = null
const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)

/**
 * A success toast with an Undo button. It stays 20 s, pauses while hovered (Mantine) and stops counting once
 * anything in it takes focus (WCAG 2.2.1). `undo` runs the reverse writes; useLedger reports a failure.
 */
export function notifyUndo({ title, message, undo }: { title?: string; message: string; undo: () => Promise<unknown> }) {
  const id = `undo-${++seq}`
  const run = () => {
    if (latest?.id === id) latest = null
    notifications.hide(id)
    undo().then(
      () => notifications.show({ icon: <Undo2 size={16} />, message: t("已復原") }),
      () => {},
    )
  }
  const data: NotificationData = {
    id,
    title,
    icon: <Check size={16} />,
    autoClose: 20000,
    onClose: () => {
      if (latest?.id === id) latest = null
    },
    message: (
      <Group justify="space-between" gap="sm" wrap="nowrap" onFocus={() => notifications.update({ ...data, autoClose: false })}>
        <Text fz="sm" inherit>
          {message}
        </Text>
        <Group gap={6} wrap="nowrap">
          <Kbd size="xs" visibleFrom="sm" aria-hidden>
            {mac ? "⌘Z" : "Ctrl+Z"}
          </Kbd>
          <Button size="compact-xs" variant="light" leftSection={<Undo2 size={12} />} aria-keyshortcuts={mac ? "Meta+Z" : "Control+Z"} onClick={run}>
            {t("復原")}
          </Button>
        </Group>
      </Group>
    ),
  }
  latest = { id, run }
  notifications.show(data)
}

/** Mounted once (App): mod+Z undoes the newest record or edit while its toast is up. Text fields keep their own undo. */
export function useUndoShortcut() {
  useHotkeys([["mod+z", () => latest?.run()]])
}
