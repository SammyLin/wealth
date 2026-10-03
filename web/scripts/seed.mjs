#!/usr/bin/env node
// Seeds a running wealth API with a realistic demo household. No deps.
//   node web/scripts/seed.mjs http://127.0.0.1:8080
// Idempotent enough for demos: accounts are matched by name, snapshots upsert, events/loans are
// skipped when one with the same name/title already exists.

const base = (process.argv[2] || process.env.WEALTH_URL || "http://127.0.0.1:8080").replace(/\/$/, "")

async function api(method, path, body) {
  const r = await fetch(base + path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${await r.text()}`)
  return r.status === 204 ? undefined : r.json()
}

// Deterministic noise so every run draws the same curve.
let seed = 42
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1
const round = (v, to = 1) => Math.round(v / to) * to

// 30 months, the 15th of each month, Apr 2024 → Sep 2026.
const MONTHS = 30
const dates = Array.from({ length: MONTHS }, (_, i) => {
  const d = new Date(Date.UTC(2024, 3 + i, 15))
  return d.toISOString().slice(0, 10)
})
const HOUSE_AT = 12 // index of the month the house (and mortgage) appear: 2025-04

// Market mood per month: steady growth, a dip around months 16–19, then recovery.
const mood = dates.map((_, i) => (i >= 16 && i <= 19 ? -0.045 - 0.01 * (i - 16) : 0.012) + rnd() * 0.012)
const usdTwd = dates.map((_, i) => +(32.1 + 0.9 * Math.sin(i / 5) + rnd() * 0.25).toFixed(3))

const accounts = [
  { name: "玉山薪轉", kind: "bank", currency: "TWD", note: "薪資戶", value: (i) => 320_000 + 18_000 * i + rnd() * 40_000 },
  { name: "國泰定存", kind: "bank", currency: "TWD", note: "一年期", value: (i) => (i < 20 ? 600_000 : 900_000) },
  { name: "元大證券", kind: "tw_stock", currency: "TWD", note: "0050、2330", value: compound(850_000, 1.9) },
  { name: "Firstrade", kind: "us_stock", currency: "USD", note: "VTI / QQQ", value: compound(22_000, 2.2) },
  { name: "幣安", kind: "crypto", currency: "USD", value: compound(3_000, 4) },
  { name: "Toyota Corolla Cross", kind: "movable", currency: "TWD", note: "2023 年牽車", value: (i) => 780_000 * Math.pow(0.988, i) },
  { name: "新店自住宅", kind: "real_estate", currency: "TWD", note: "2025.04 交屋", from: HOUSE_AT, value: (i) => 18_600_000 + 45_000 * (i - HOUSE_AT) },
  { name: "房貸(土銀)", kind: "liability", currency: "TWD", note: "青安 + 一般,兩段", from: HOUSE_AT, value: mortgageOwed },
]

/** Portfolio following `mood`, with monthly contributions of `start/100`. */
function compound(start, beta) {
  let v = start
  const path = mood.map((m) => (v = v * (1 + m * beta) + start / 100))
  return (i) => path[i]
}

// Two tranches on one mortgage: 青安 10M @1.775% 40y, 5y interest-only; 一般 4M @2.3% 20y.
const loans = [
  { name: "房貸 A・青安", principal: 10_000_000, rate: 0.01775, start: dates[HOUSE_AT], grace_months: 60, total_months: 480 },
  { name: "房貸 B・一般", principal: 4_000_000, rate: 0.023, start: dates[HOUSE_AT], grace_months: 0, total_months: 240 },
]
function level(p, r, n) {
  const m = r / 12
  return (p * m) / (1 - Math.pow(1 + m, -n))
}
function owed(l, months) {
  if (months <= l.grace_months) return l.principal
  const m = l.rate / 12
  const n = l.total_months - l.grace_months
  const pay = level(l.principal, l.rate, n)
  let b = l.principal
  for (let k = 0; k < months - l.grace_months; k++) b = b * (1 + m) - pay
  return b
}
function mortgageOwed(i) {
  return loans.reduce((s, l) => s + owed(l, i - HOUSE_AT), 0)
}

const events = [
  { date: "2024-09-02", title: "換工作,年薪 +25%" },
  { date: dates[HOUSE_AT], title: "新店交屋,開始還房貸" },
  { date: "2026-01-20", title: "老二出生" },
]

async function main() {
  const state = await api("GET", "/api/state")
  const byName = new Map(state.accounts.map((a) => [a.name, a]))
  for (const a of accounts) {
    if (byName.has(a.name)) continue
    const made = await api("POST", "/api/accounts", { name: a.name, kind: a.kind, currency: a.currency, note: a.note ?? "" })
    byName.set(a.name, made)
  }
  const ids = accounts.map((a) => byName.get(a.name).id)
  await api("PUT", "/api/accounts/order", { ids })

  const snapshots = []
  accounts.forEach((a, k) => {
    dates.forEach((date, i) => {
      if (i < (a.from ?? 0)) return
      if (a.kind === "real_estate" && i > a.from && (i - a.from) % 6) return // revalued twice a year
      const usd = a.currency === "USD"
      snapshots.push({ account_id: ids[k], date, amount: round(Math.max(0, a.value(i)), usd ? 1 : 100), fx: usd ? usdTwd[i] : 1 })
    })
  })
  for (let i = 0; i < snapshots.length; i += 40) await api("POST", "/api/snapshots", snapshots.slice(i, i + 40))

  const titles = new Set(state.events.map((e) => e.title))
  for (const e of events) if (!titles.has(e.title)) await api("POST", "/api/events", e)

  const loanNames = new Set(state.loans.map((l) => l.name))
  const mortgage = byName.get("房貸(土銀)").id
  for (const l of loans) if (!loanNames.has(l.name)) await api("POST", "/api/loans", { ...l, account_id: mortgage })

  await api("PUT", "/api/settings", { title: "林家帳本", subtitle: "只記餘額,看見長期趨勢" })
  const after = await api("GET", "/api/state")
  const last = after.series.at(-1)
  console.log(`seeded ${base}: ${after.accounts.length} accounts, ${snapshots.length} snapshots, ${after.events.length} events, ${after.loans.length} loans; net worth ${Math.round(last.total).toLocaleString()} on ${last.date}`)
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
