/// <reference types="node" />
// Self-check, not bundled: `node src/i18n/strings.check.ts`. Every EN table shares one key space, so a key
// translated two ways would silently show whichever table loads last. This fails on any such conflict.
import { readdirSync, existsSync, readFileSync } from "node:fs"

const dir = new URL("../features/", import.meta.url)
const tables: [string, Record<string, string>][] = [["i18n/en.ts", (await import("./en.ts")).en]]
for (const f of readdirSync(dir)) {
  const p = new URL(`${f}/strings.ts`, dir)
  if (existsSync(p)) tables.push([`features/${f}/strings.ts`, (await import(p.href)).en])
}
const seen = new Map<string, [string, string]>()
const bad: string[] = []
for (const [file, en] of tables)
  for (const [k, v] of Object.entries(en)) {
    const prev = seen.get(k)
    if (prev && prev[1] !== v) bad.push(`"${k}": ${prev[0]} says "${prev[1]}", ${file} says "${v}"`)
    else seen.set(k, [file, v])
    if (v.split("|").length > 2) bad.push(`"${k}" in ${file}: a plural takes exactly one "|"`)
  }

// Missing keys: every literal t("…") / T`…` in the UI and every Chinese message the Go API sends
// (bad(), errf(), validation returns) needs an English entry, or English users see Chinese.
const src = new URL("../", import.meta.url)
const go = new URL("../../../internal/ledger/", import.meta.url)
const files = (d: URL, ext: RegExp): URL[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(new URL(`${e.name}/`, d), ext) : ext.test(e.name) && !/check|_test/.test(e.name) ? [new URL(e.name, d)] : [],
  )
const han = /[\u4e00-\u9fff]/
// `a ${f({ x })} b` → "a {} b": ${…} can hold braces, so match them by depth rather than with a regex
const holes = (tpl: string) => {
  let out = "", depth = 0
  for (let i = 0; i < tpl.length; i++) {
    if (!depth && tpl.startsWith("${", i)) {
      out += "{}"
      depth = 1
      i++
    } else if (depth) depth += tpl[i] === "{" ? 1 : tpl[i] === "}" ? -1 : 0
    else out += tpl[i]
  }
  return out
}
const missing = new Set<string>()
const need = (k: string, where: string) => han.test(k) && !seen.has(k) && missing.add(`${where}: "${k}"`)
// Not UI text: demo data carries its own English, format.ts's 萬/億 are unit suffixes, 中文 names the language.
const NOT_UI = /lib\/(demo|format)\.ts$|strings\.ts$|i18n\/en\.ts$/
for (const f of files(src, /\.tsx?$/).filter((f) => !f.pathname.endsWith("i18n/index.ts"))) {
  const text = readFileSync(f, "utf8")
  const where = f.pathname.split("/src/")[1]
  for (const m of text.matchAll(/\bt\(\s*"([^"]+)"\s*\)/g)) need(m[1], where)
  for (const m of text.matchAll(/\bT`([^`]*)`/g)) need(holes(m[1]), where)
  if (NOT_UI.test(where)) continue
  // Han written straight into JSX (<Text>總資產</Text>) never reaches t(): always an error
  const code = text.replace(/\{\/\*[\s\S]*?\*\/\}|\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
  for (const m of code.matchAll(/>([^<>{}]*[\u4e00-\u9fff][^<>{}]*)</g)) bad.push(`${where}: Chinese JSX text not wrapped in t(): "${m[1].trim()}"`)
  // and any other Chinese string literal (a `label: "…"` rendered later with t(label)) needs its English too
  for (const m of code.replace(/`(?:[^`\\]|\\.)*`/g, "``").matchAll(/"([^"\n]*[\u4e00-\u9fff][^"\n]*)"/g)) if (m[1] !== "中文") need(m[1], where)
}
for (const f of files(go, /\.go$/)) {
  const text = readFileSync(f, "utf8")
  const where = f.pathname.split("/internal/")[1]
  for (const m of text.matchAll(/(?:bad\(c, [^,]+, |errf\(|errs\.add\(|return |"error": )"([^"]+)"/g)) need(m[1], where)
}
if (missing.size) bad.push("missing English:\n" + [...missing].join("\n"))

if (bad.length) throw new Error(bad.join("\n"))
console.log(`strings ok (${seen.size} keys)`)
