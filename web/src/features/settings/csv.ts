// Client-side preview of POST /api/import. Mirrors parseImport in internal/ledger/import.go closely enough
// to flag problems before upload; the server stays the authority. Runs in Node too (csv.check.ts).
// Errors are Chinese i18n keys ({} holes) with their values; the caller renders them with tKey().
import { parseAmount, toIso, toMs, todayISO } from "../../lib/format.ts"

/** `future` rows are otherwise fine but dated after tomorrow, which the server rejects. */
export type ImportRow = { line: number; date: string; account: string; amount: number; fx: number | null; ok: boolean; future: boolean }
export type ParsedImport = { rows: ImportRow[]; error?: string; params?: unknown[] }

export const MAX_IMPORT_ROWS = 1000 // same cap as the server

/** Thrown for what Go's csv.Reader rejects: a quote inside an unquoted field, or text after a closing quote. */
export class CSVError extends Error {
  line: number
  constructor(line: number) {
    super(`bad quote on line ${line}`)
    this.line = line
  }
}

/** RFC 4180 records: quoted fields, "" escapes, CRLF or LF. Blank lines are skipped, like Go's csv.Reader. */
export function splitCSV(text: string): string[][] {
  const out: string[][] = []
  let rec: string[] = []
  let field = ""
  let quoted = false
  const endRecord = () => {
    rec.push(field)
    out.push(rec)
    rec = []
    field = ""
  }
  let line = 1
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === "\n") line++
    if (quoted) {
      if (c !== '"') field += c
      else if (text[i + 1] === '"') field += text[i++]
      else if (i + 1 < text.length && !",\r\n".includes(text[i + 1])) throw new CSVError(line)
      else quoted = false
    } else if (c === '"') {
      if (field) throw new CSVError(line)
      quoted = true
    } else if (c === ",") {
      rec.push(field)
      field = ""
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++
      endRecord()
    } else field += c
  }
  if (field || rec.length) endRecord()
  return out.filter((r) => r.some((f) => f.trim()))
}

/** A real calendar day in 1900–2199 (2026-02-31 is not), the same range as the server's validDate. */
const validDate = (s: string) => /^(19|20|21)\d\d-\d\d-\d\d$/.test(s) && !Number.isNaN(toMs(s)) && toIso(toMs(s)) === s

/** Long layout `date,account,amount[,fx]`; the header decides column order, an Excel BOM is dropped. */
export function parseImport(text: string, today = todayISO()): ParsedImport {
  let records: string[][]
  try {
    records = splitCSV(text.replace(/^\uFEFF/, ""))
  } catch (e) {
    if (e instanceof CSVError) return { rows: [], error: "第 {} 列格式錯誤", params: [e.line] }
    throw e
  }
  const tomorrow = toIso(toMs(today) + 864e5) // the server allows one day for time zones
  const [head, ...recs] = records
  if (!head) return { rows: [], error: "CSV 是空的或格式錯誤" }
  const [di, ai, mi, fi] = ["date", "account", "amount", "fx"].map((n) => head.findIndex((h) => h.trim().toLowerCase() === n))
  if (di < 0 || ai < 0 || mi < 0)
    return { rows: [], error: head.length === 1 && head[0].includes(";") ? "這個檔案用分號分隔,請改成逗號分隔的 CSV" : "第一列要是標題:date,account,amount,fx(fx 可省略)" }
  const rows = recs.map((r, i): ImportRow => {
    const f = (j: number) => (j >= 0 ? (r[j] ?? "").trim() : "")
    const amount = parseAmount(f(mi)) // same shorthand as the record dialog: 1,234 / 12.5萬 / 3k
    const fx = f(fi) ? Number(f(fi)) : null
    const date = f(di)
    const account = f(ai).replace(/^'(?=[=+\-@\t\r'])/, "") // undo the export's formula escaping (unescapeCell)
    const ok = validDate(date) && account !== "" && Math.abs(amount) <= 1e15 && (fx === null || (fx > 0 && fx <= 1e6))
    return { line: i + 2, date, account, amount, fx, ok, future: ok && date > tomorrow }
  })
  if (!rows.length) return { rows, error: "CSV 沒有資料列" }
  if (rows.length > MAX_IMPORT_ROWS) return { rows, error: "一次最多匯入 {} 筆,請分批", params: [MAX_IMPORT_ROWS] }
  return { rows }
}

/** One CSV field, quoted only when it has to be. */
export const csvField = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s)
