import type { ReactNode } from "react"
import { Text } from "@mantine/core"
import { modals } from "@mantine/modals"
import { t } from "../i18n"

type Confirm = {
  title: ReactNode
  body: ReactNode
  confirm: string
  onConfirm: () => void
  /** Red confirm button: deletes, overwrites, discards. */
  danger?: boolean
  cancel?: string
  onClose?: () => void
}

/** The one shape every "are you sure" in the app takes (the brief: every destructive action asks first). */
export function askConfirm({ title, body, confirm, onConfirm, danger, cancel = t("取消"), onClose }: Confirm) {
  modals.openConfirmModal({
    title,
    children: <Text fz="sm">{body}</Text>,
    labels: { confirm, cancel },
    confirmProps: danger ? { color: "down" } : undefined,
    onConfirm,
    onClose,
  })
}
