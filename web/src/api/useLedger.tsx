/* oxlint-disable react/only-export-components -- the provider and its hooks live together per docs/BRIEF.md */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { notifications } from "@mantine/notifications"
import { t, useLang } from "../i18n"
import { fmtMoney, type MoneyOpts } from "../lib/format"
import * as api from "./client"
import type { NewAccount, State } from "./types"

// Every mutation: call the API, then reload /api/state (after a failure too: a multi-step mutation like the
// import may have done part of its work). On failure a notification is shown and the error is rethrown, so a
// dialog can `try { await m.x(); close() } catch { /* stay open */ }`.

function useLedgerValue() {
  const [state, setState] = useState<State | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  // Only the latest request may land: an older, slower response must not overwrite a newer one. A failed
  // refresh keeps the data already shown and sets `error`, which App shows as a banner.
  const latest = useRef(0)
  const refresh = useCallback(async () => {
    const n = ++latest.current
    try {
      const s = await api.getState()
      if (n !== latest.current) return
      setState(s)
      setError(null)
    } catch (e) {
      if (n === latest.current) setError(e as Error)
    } finally {
      if (n === latest.current) setLoading(false)
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
          return await fn(...args)
        } catch (e) {
          notifications.show({ color: "down", title: t("操作失敗"), message: (e as Error).message })
          throw e
        } finally {
          await refresh()
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
      // One request: the server creates the accounts the CSV names but the ledger lacks, then imports.
      importCSV: wrap((csv: Blob, create: NewAccount[] = []) => api.importCSV(csv, create)),
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
