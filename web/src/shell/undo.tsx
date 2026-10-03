import { Button, Group, Text } from "@mantine/core"
import { notifications } from "@mantine/notifications"
import { Check, Undo2 } from "lucide-react"
import { t } from "../i18n"

let seq = 0

/** A success toast with an Undo button (8 s). `undo` runs the reverse writes; useLedger reports a failure. */
export function notifyUndo({ title, message, undo }: { title?: string; message: string; undo: () => Promise<unknown> }) {
  const id = `undo-${++seq}`
  notifications.show({
    id,
    title,
    icon: <Check size={16} />,
    autoClose: 8000,
    message: (
      <Group justify="space-between" gap="sm" wrap="nowrap">
        <Text fz="sm" inherit>
          {message}
        </Text>
        <Button
          size="compact-xs"
          variant="light"
          leftSection={<Undo2 size={12} />}
          onClick={() => {
            notifications.hide(id)
            undo().then(
              () => notifications.show({ icon: <Undo2 size={16} />, message: t("已復原") }),
              () => {},
            )
          }}
        >
          {t("復原")}
        </Button>
      </Group>
    ),
  })
}
