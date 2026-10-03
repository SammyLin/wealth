import { T, t, tKey } from "../i18n"
import type { Account, AccountPatch, Event, EventInput, Kind, KindInput, Loan, LoanInput, NewAccount, Settings, Snapshot, State } from "./types"

// One function per route. Failures throw Error whose message is the server's {error}, translated
// (messages with values come with key + params, looked up like a T`` string).
async function api<R = void>(method: string, path: string, body?: unknown, type = "application/json"): Promise<R> {
  let r: Response
  try {
    r = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": type },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    })
  } catch {
    throw new Error(t("連不到伺服器,確認 wealth 程式還在執行"))
  }
  if (!r.ok) {
    const body = await r.json().catch(() => null)
    throw new Error(body?.key ? tKey(body.key, body.params ?? []) : body?.error ? t(body.error) : T`伺服器回應 ${r.status}`)
  }
  return (r.status === 204 ? undefined : await r.json()) as R
}

const q = encodeURIComponent

export const getState = () => api<State>("GET", "/api/state")
export const putSettings = (s: Partial<Settings>) => api("PUT", "/api/settings", s)

export const createKind = (k: Kind) => api<Kind>("POST", "/api/kinds", k)
export const updateKind = (key: string, k: KindInput) => api<Kind>("PUT", `/api/kinds/${q(key)}`, k)
export const deleteKind = (key: string) => api("DELETE", `/api/kinds/${q(key)}`)
export const orderKinds = (keys: string[]) => api("PUT", "/api/kinds/order", { keys })

export const createAccount = (a: NewAccount) => api<Account>("POST", "/api/accounts", a)
export const patchAccount = (id: number, p: AccountPatch) => api("PATCH", `/api/accounts/${id}`, p)
export const orderAccounts = (ids: number[]) => api("PUT", "/api/accounts/order", { ids })
export const deleteAccount = (id: number) => api("DELETE", `/api/accounts/${id}`)

export const putSnapshots = (s: Snapshot[]) => api("POST", "/api/snapshots", s)
export const deleteSnapshot = (accountId: number, date: string) =>
  api("DELETE", `/api/snapshots?account_id=${accountId}&date=${q(date)}`)
/** CSV with header `date,account,amount,fx` (fx optional). */
export const importCSV = (csv: string) => api<{ imported: number }>("POST", "/api/import", csv, "text/csv")

export const saveEvent = ({ id, ...e }: EventInput) => api<Event>(id ? "PUT" : "POST", id ? `/api/events/${id}` : "/api/events", e)
export const deleteEvent = (id: number) => api("DELETE", `/api/events/${id}`)

export const saveLoan = ({ id, ...l }: LoanInput) => api<Loan>(id ? "PUT" : "POST", id ? `/api/loans/${id}` : "/api/loans", l)
export const deleteLoan = (id: number) => api("DELETE", `/api/loans/${id}`)

/** Rate that converts 1 `cur` into the base currency on `date` (YYYY-MM-DD). */
export const getFx = (cur: string, date: string) =>
  api<{ rate: number }>("GET", `/api/fx?cur=${q(cur)}&date=${q(date)}`).then((r) => r.rate)

// Plain links (use as <a href download>)
/** Wide spreadsheet layout (accounts × dates); labels in English with en. */
export const exportCsvUrl = (en: boolean) => (en ? "/api/export.csv?lang=en" : "/api/export.csv")
/** date,account,amount,fx: the layout importCSV reads back. */
export const EXPORT_LONG_URL = "/api/export.csv?layout=long"
export const BACKUP_DB_URL = "/api/backup.db" // only when state.file_backups
