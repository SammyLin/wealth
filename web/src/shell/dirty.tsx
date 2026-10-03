/* oxlint-disable react/only-export-components -- the context and its hooks belong together */
import { createContext, useContext, useEffect, useId, useRef, useState } from "react"
import { askConfirm } from "./confirm"
import { t } from "../i18n"

// Unsaved edits inside a dialog: forms report with useDirty(isDirty); the dialog wraps its onClose with
// useGuardedClose and provides the registry, so Esc / X / backdrop ask before throwing edits away.

export const DirtyContext = createContext<Set<string> | null>(null)

/** Marks the enclosing dialog as holding unsaved edits while `dirty` is true (`own`: a dialog marking itself). */
export function useDirty(dirty: boolean, own?: Set<string>) {
  const ctx = useContext(DirtyContext)
  const set = own ?? ctx
  const id = useId()
  useEffect(() => {
    if (!set || !dirty) return
    set.add(id)
    return () => void set.delete(id)
  }, [set, dirty, id])
}

type Ask = { title: string; body: string; cancel: string }

/**
 * `close` asks first when any form inside reported unsaved edits; provide `dirty` through DirtyContext.
 * `ask` replaces the generic wording (記一筆 says how many balances would be lost).
 */
export function useGuardedClose(onClose: () => void, ask?: Ask) {
  const [dirty] = useState(() => new Set<string>())
  // Mantine's modal and the confirm both listen for Esc: ignore close requests while the confirm is up.
  const confirming = useRef(false)
  const close = () => {
    if (confirming.current) return
    if (!dirty.size) return onClose()
    confirming.current = true
    askConfirm({
      title: ask?.title ?? t("放棄未儲存的修改?"),
      body: ask?.body ?? t("關掉後,還沒按儲存的修改都不會保留。"),
      confirm: t("放棄"),
      cancel: ask?.cancel ?? t("繼續編輯"),
      danger: true,
      onConfirm: () => {
        dirty.clear()
        onClose()
      },
      onClose: () => setTimeout(() => (confirming.current = false)),
    })
  }
  return { dirty, close }
}
