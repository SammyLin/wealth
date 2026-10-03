/* oxlint-disable react/only-export-components -- the provider and its hooks live together per docs/BRIEF.md */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { notifications } from "@mantine/notifications"
import { t, useLang } from "../i18n"
import { fmtMoney, type MoneyOpts } from "../lib/format"
import * as api from "./client"
import type { State } from "./types"

// Every mutation: call the API, then reload /api/state. On failure a notification is shown and the
// error is rethrown, so a dialog can `try { await m.x(); close() } catch { /* stay open */ }`.

function useLedgerValue() {
  const [state, setState] = useState<State | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async () => {
    try {
      setState(await api.getState())
      setError(null)
    } catch (e) {
      setError(e as Error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- initial fetch; state is set after the await
    void refresh()
  }, [refresh])

  const mutations = useMemo(() => {
    const wrap =
      <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
      async (...args: A): Promise<R> => {
        try {
          const r = await fn(...args)
          await refresh()
          return r
        } catch (e) {
          notifications.show({ color: "red", title: t("操作失敗"), message: (e as Error).message })
          throw e
        }
      }
    return {
      saveSettings: wrap(api.putSettings),
      createKind: wrap(api.createKind),
      updateKind: wrap(api.updateKind),
      deleteKind: wrap(api.deleteKind),
      reorderKinds: wrap(api.orderKinds),
      createAccount: wrap(api.createAccount),
      updateAccount: wrap(api.patchAccount),
      reorderAccounts: wrap(api.orderAccounts),
      deleteAccount: wrap(api.deleteAccount),
      saveSnapshots: wrap(api.putSnapshots),
      deleteSnapshot: wrap(api.deleteSnapshot),
      importCSV: wrap(api.importCSV),
      saveEvent: wrap(api.saveEvent),
      deleteEvent: wrap(api.deleteEvent),
      saveLoan: wrap(api.saveLoan),
      deleteLoan: wrap(api.deleteLoan),
    }
  }, [refresh])

  return useMemo(() => ({ state, loading, error, refresh, ...mutations }), [state, loading, error, refresh, mutations])
}

export type Ledger = ReturnType<typeof useLedgerValue>
const LedgerContext = createContext<Ledger | null>(null)

export function LedgerProvider({ children }: { children: ReactNode }) {
  return <LedgerContext.Provider value={useLedgerValue()}>{children}</LedgerContext.Provider>
}

export function useLedger(): Ledger {
  const v = useContext(LedgerContext)
  if (!v) throw new Error("useLedger must be used inside <LedgerProvider>")
  return v
}

/**
 * Like useLedger(), for components that only render once data exists (every section and dialog does:
 * App shows them only after the first load). `state` is non-null.
 */
export function useLedgerState(): Ledger & { state: State } {
  const v = useLedger()
  if (!v.state) throw new Error("useLedgerState called before /api/state loaded")
  return v as Ledger & { state: State }
}

/** money(v) formats in the ledger's unit and the UI language: money(1.25e5) → "12.5萬". */
export function useMoney() {
  const { state } = useLedger()
  const { lang } = useLang()
  const unit = state?.settings.unit ?? "wan"
  return useCallback((v: number, opts?: MoneyOpts) => fmtMoney(v, unit, lang, opts), [unit, lang])
}
