import type { Lang } from "../i18n"
import type { Unit } from "../api/types"

// Pure formatters. In components prefer useMoney() from api/useLedger, which supplies unit and lang.
// Render amounts inside className="num" so digits are tabular.

const locale = (lang: Lang) => (lang === "en" ? "en-US" : "zh-TW")
const num = (v: number, lang: Lang, digits: number) =>
  v.toLocaleString(locale(lang), { maximumFractionDigits: digits, minimumFractionDigits: 0 })

export type MoneyOpts = { signed?: boolean } // signed: "+1.2萬" / "−1.2萬" (true minus sign)

// Unit steps per setting: [divisor, decimals, suffix], smallest first.
const STEPS: Record<Unit, [number, number, string][]> = {
  wan: [[1e4, 1, "萬"], [1e8, 2, "億"]],
  k: [[1e3, 1, "K"], [1e6, 2, "M"], [1e9, 2, "B"]],
  full: [],
}
const roundTo = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits

/** 12345678 → wan "1,234.6萬" (≥1e8 "1.23億"), k "12.35M", full "12,345,678". */
export function fmtMoney(value: number, unit: Unit, lang: Lang = "zh", opts: MoneyOpts = {}): string {
  const a = Math.abs(value)
  // Round at the current step before deciding to climb, so 99,999,999 is "1億", not "10,000萬".
  let [div, digits, suffix] = [1, 0, ""]
  for (const [d, dg, sf] of STEPS[unit]) if (roundTo(a / div, digits) * div >= d) [div, digits, suffix] = [d, dg, sf]
  const s = num(a / div, lang, digits) + suffix
  const neg = value < 0 && s !== "0"
  return (neg ? "−" : opts.signed && value > 0 && s !== "0" ? "+" : "") + s
}

// The UI language for dates; i18n/index.ts keeps it in sync so fmtDate needs no argument.
let dateLang: Lang = "zh"
export const setDateLang = (l: Lang) => void (dateLang = l)
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** zh: "2026-10-03" → "2026.10.03", "2026-10" → "2026.10". en: "Oct 3, 2026", "Oct 2026". */
export function fmtDate(iso: string): string {
  if (!iso) return ""
  if (dateLang !== "en") return iso.replaceAll("-", ".")
  const [y, m, d] = iso.split("-")
  const mon = MONTHS[Number(m) - 1] ?? m
  return d ? `${mon} ${Number(d)}, ${y}` : `${mon} ${y}`
}

/** Chart axis tick: zh "2026.10" / "10/03", en "Oct 2026" / "Oct 3" (`day` for ranges short enough that months repeat). */
export function fmtTick(iso: string, day: boolean): string {
  if (!day) return fmtDate(iso.slice(0, 7))
  if (dateLang !== "en") return iso.slice(5).replace("-", "/")
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`
}

/** Today in local time as "YYYY-MM-DD". */
export function todayISO(): string {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10)
}

/** "2026-10-03" ↔ UTC ms, so chart x axes are real time and gaps between records keep their width. */
export const toMs = (iso: string) => Date.parse(iso)
export const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** A currency code as the server takes it (validCurrency), after upper-casing. */
export const CURRENCY_RE = /^[A-Z]{3}$/
/** A kind color as the server takes it (colorRe). */
export const HEX_RE = /^#[0-9a-f]{6}$/i

/** Currencies suggested in pickers, after the ones the ledger already uses. */
export const CURRENCIES = ["TWD", "USD", "JPY", "EUR", "CNY", "HKD", "GBP", "AUD", "CAD", "SGD", "CHF", "KRW", "NZD", "THB", "MYR", "VND"]

/** 1234567.5 → "1,234,567.5" for an editable input (always "," thousands, which parseAmount reads back). */
export const fmtInput = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 6 })

/**
 * Exchange rates span ten orders of magnitude (KRW→USD 0.000745, USD→IDR 16,000), so they are shown with
 * significant digits, never fixed decimals, and stored at full precision.
 */
export const fmtFx = (rate: number) => rate.toLocaleString("en-US", { maximumSignificantDigits: 6 })

/** What a rate field shows: the full typed text while focused, otherwise fmtFx's 6 significant digits so it fits. */
export const fxShown = (text: string, focused: boolean) => {
  const n = parseFx(text)
  return focused || !(n > 0) ? text : fmtFx(n)
}

/** A typed rate: plain decimal, "1,234.5" or full-width digits. NaN if not a positive-looking number. Unlike parseAmount it doesn't round to 6 decimals. */
export const parseFx = (input: string): number => {
  const s = input.normalize("NFKC").replace(/[\s,]/g, "")
  return /^(\d+\.?\d*|\.\d+)(e-?\d+)?$/i.test(s) ? Number(s) : NaN
}

const MONTH_RE = new RegExp(`^(${MONTHS.join("|")})[a-z]*\\.? (\\d{1,2}),? (\\d{4})$`, "i")

/**
 * A typed date → "YYYY-MM-DD", or null: 2026-10-03, 2026.10.03, 2026/10/3, and "Oct 3, 2026" / "October 3 2026".
 * Strict: the day must exist (2026-02-31 is null, not Mar 3) and stray text never parses.
 */
export function parseDay(v: string): string | null {
  const s = v.trim()
  let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(s)
  let y: number, mo: number, d: number
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  else if ((m = MONTH_RE.exec(s))) [y, mo, d] = [Number(m[3]), MONTHS.findIndex((x) => x.toLowerCase() === m![1].slice(0, 3).toLowerCase()) + 1, Number(m[2])]
  else return null
  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`
  return toIso(Date.UTC(y, mo - 1, d)) === iso ? iso : null
}

/** 0.0234 → "2.3%"; signed adds "+" / "−". */
export function fmtPct(ratio: number, digits = 1, signed = false): string {
  const s = (Math.abs(ratio) * 100).toFixed(digits) + "%"
  return (ratio < 0 && Number(s.slice(0, -1)) ? "−" : signed && ratio > 0 ? "+" : "") + s
}

const UNITS: Record<string, number> = { "萬": 1e4, "万": 1e4, "億": 1e8, "亿": 1e8, "千": 1e3, k: 1e3, m: 1e6, b: 1e9 }

/**
 * Parses what people type or paste: "1,234,567", "12.5萬", "3k", "−500", full-width digits. NaN if not a number.
 * Commas must be thousands separators, so "1.234,56" is rejected rather than read as 1.23456.
 * internal/ledger/import.go parseAmount mirrors this for CSV imports.
 */
export function parseAmount(input: string): number {
  let s = input
    .normalize("NFKC") // full-width digits, commas and minus → ASCII
    .replace(/[\s_]|元|NT\$|\$/gi, "")
    .replace(/^[−–]/, "-")
    .toLowerCase()
  if (s.includes(",")) {
    if (!/^[+-]?\d{1,3}(,\d{3})+(\.\d*)?(萬|万|億|亿|千|k|m|b)?$/.test(s)) return NaN
    s = s.replaceAll(",", "")
  }
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))(萬|万|億|亿|千|k|m|b)?$/.exec(s)
  if (!m) return NaN
  return Math.round(Number(m[1]) * (m[2] ? UNITS[m[2]] : 1) * 1e6) / 1e6
}
