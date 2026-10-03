import { useSyncExternalStore } from "react"
import { setDateLang } from "../lib/format"
import { en as shellEn } from "./en"

// Strings are written in Chinese and looked up by that text; a missing English entry falls back to Chinese.
// English comes from i18n/en.ts (shell + server messages) and every features/*/strings.ts `en` export.
// One key space: the same Chinese key must mean the same English everywhere (strings.check.ts enforces it).
// Plurals: an English value "{} account|{} accounts" picks by the first number passed to T``.

export type Lang = "zh" | "en"

const featureTables = import.meta.glob<Record<string, string>>("../features/*/strings.ts", { eager: true, import: "en" })
const EN: Record<string, string> = Object.assign(Object.create(null), shellEn, ...Object.values(featureTables))

function initialLang(): Lang {
  let saved: string | null = null
  try {
    saved = localStorage.getItem("lang")
  } catch {
    /* storage blocked */
  }
  return (saved ?? (navigator.language.startsWith("zh") ? "zh" : "en")) === "en" ? "en" : "zh"
}

let lang: Lang = initialLang()
setDateLang(lang)
const listeners = new Set<() => void>()

export function t(zh: string): string {
  return lang === "en" && Object.hasOwn(EN, zh) ? EN[zh] : zh
}

const plural = new Intl.PluralRules("en")

/** Fills "{}" holes in order; a list value is joined with the language's separator. */
function fill(s: string, values: readonly unknown[]): string {
  if (s.includes("|")) {
    const n = values.find((v) => typeof v === "number") as number | undefined
    const [one, other] = s.split("|")
    s = n !== undefined && plural.select(n) === "one" ? one : other
  }
  let i = 0
  return s.replace(/\{\}/g, () => {
    const v = values[i++]
    return Array.isArray(v) ? v.join(t("、")) : String(v)
  })
}

/** T`截至 ${d}` looks up "截至 {}" and fills the values back in, in order. */
export function T(strs: TemplateStringsArray, ...values: unknown[]): string {
  return fill(t(strs.join("{}")), values)
}

/** For server errors that carry `key` ("還有 {} 個帳戶…") and `params`: the same lookup as T``. */
export const tKey = (key: string, params: readonly unknown[]) => fill(t(key), params)

export function setLang(next: Lang) {
  lang = next
  setDateLang(next)
  try {
    localStorage.setItem("lang", next)
  } catch {
    /* storage blocked */
  }
  document.documentElement.lang = next === "en" ? "en" : "zh-Hant"
  listeners.forEach((l) => l())
}

/** Subscribes the caller to language changes. main.tsx calls it at the root, so the whole tree re-renders on switch. */
export function useLang() {
  const current = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => lang,
  )
  return { lang: current, setLang }
}
