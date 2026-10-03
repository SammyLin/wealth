import type { Lang } from "../i18n"
import type { Unit } from "../api/types"

// Pure formatters. In components prefer useMoney() from api/useLedger, which supplies unit and lang.
// Render amounts inside className="num" so digits are tabular.

const locale = (lang: Lang) => (lang === "en" ? "en-US" : "zh-TW")
const num = (v: number, lang: Lang, digits: number) =>
  v.toLocaleString(locale(lang), { maximumFractionDigits: digits, minimumFractionDigits: 0 })

export type MoneyOpts = { signed?: boolean } // signed: "+1.2萬" / "−1.2萬" (true minus sign)

/** 12345678 → wan "1,234.6萬" (≥1e8 "1.23億"), k "12.35M", full "12,345,678". */
export function fmtMoney(value: number, unit: Unit, lang: Lang = "zh", opts: MoneyOpts = {}): string {
  const a = Math.abs(value)
  let s: string
  if (unit === "wan" && a >= 1e8) s = num(a / 1e8, lang, 2) + "億"
  else if (unit === "wan" && a >= 1e4) s = num(a / 1e4, lang, 1) + "萬"
  else if (unit === "k" && a >= 1e9) s = num(a / 1e9, lang, 2) + "B"
  else if (unit === "k" && a >= 1e6) s = num(a / 1e6, lang, 2) + "M"
  else if (unit === "k" && a >= 1e3) s = num(a / 1e3, lang, 1) + "K"
  else s = num(Math.round(a), lang, 0)
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

/** Currencies suggested in pickers, after the ones the ledger already uses. */
export const CURRENCIES = ["TWD", "USD", "JPY", "EUR", "CNY", "HKD", "GBP", "AUD", "CAD", "SGD", "CHF", "KRW", "NZD", "THB", "MYR", "VND"]

/** 1234567.5 → "1,234,567.5" for an editable input (always "," thousands, which parseAmount reads back). */
export const fmtInput = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 6 })

/**
 * Exchange rates span ten orders of magnitude (KRW→USD 0.000745, USD→IDR 16,000), so they are shown with
 * significant digits, never fixed decimals, and stored at full precision.
 */
export const fmtFx = (rate: number) => rate.toLocaleString("en-US", { maximumSignificantDigits: 6 })

/** A typed rate: plain decimal, "1,234.5" or full-width digits. NaN if not a positive-looking number. Unlike parseAmount it doesn't round to 6 decimals. */
export const parseFx = (input: string): number => {
  const s = input.normalize("NFKC").replace(/[\s,]/g, "")
  return /^(\d+\.?\d*|\.\d+)(e-?\d+)?$/i.test(s) ? Number(s) : NaN
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
