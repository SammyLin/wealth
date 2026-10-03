import { T, t, tKey } from "../i18n"
import { todayISO } from "../lib/format"
import type { Account, AccountPatch, ApiError, Event, EventInput, ImportPreview, Kind, KindInput, Loan, LoanInput, NewAccount, Settings, Snapshot, State } from "./types"

/** A server {error, key?, params?} in the UI language (messages with values are looked up like a T`` string). */
export const apiMessage = (e: ApiError) => (e.key ? tKey(e.key, e.params ?? []) : t(e.error))

// One function per route. Failures throw Error whose message is the server's {error}, translated
// (messages with values come with key + params, looked up like a T`` string).
async function api<R = void>(method: string, path: string, body?: unknown, type = "application/json"): Promise<R> {
  let r: Response
  try {
    r = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": type },
      body: body === undefined ? undefined : typeof body === "string" || body instanceof Blob ? body : JSON.stringify(body),
    })
  } catch {
    throw new Error(t("連不到伺服器,確認 wealth 程式還在執行"))
  }
  if (!r.ok) {
    const body = await r.json().catch(() => null)
    throw new Error(body?.error ? apiMessage(body) : T`伺服器回應 ${r.status}`)
  }
  return (r.status === 204 ? undefined : await r.json()) as R
}

const q = encodeURIComponent

// today: the browser's date, so loan figures for "this month" match the UI's around a month boundary
export const getState = () => api<State>("GET", `/api/state?today=${todayISO()}`)
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
/**
 * CSV with header `date,account,amount[,fx][,kind][,currency]`, sent as the file's raw bytes: the server checks
 * the encoding (a Big5 Excel export gets its "save as CSV UTF-8" hint) and is the only parser. `create` names
 * the accounts to make for names the ledger lacks; the server makes them only once every check and rate
 * lookup has passed, so a failed import leaves no empty accounts behind.
 */
export const importCSV = (csv: Blob | string, create: NewAccount[] = []) =>
  api<{ imported: number; created: number }>("POST", `/api/import${create.length ? `?accounts=${q(JSON.stringify(create))}` : ""}`, csv, "text/csv")
/** The same checks without writing or fetching: what the import would do and every problem with it. */
export const previewImport = (csv: Blob | string, create: NewAccount[] = []) =>
  api<ImportPreview>("POST", `/api/import?dry_run=1${create.length ? `&accounts=${q(JSON.stringify(create))}` : ""}`, csv, "text/csv")

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
/** date,account,amount,fx,kind,currency: the layout importCSV reads back. */
export const EXPORT_LONG_URL = "/api/export.csv?layout=long"
export const BACKUP_DB_URL = "/api/backup.db" // only when state.file_backups
