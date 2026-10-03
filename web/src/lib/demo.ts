// A realistic demo household: 30 months of balances for eight accounts (two in USD), a house bought with a
// two-tranche mortgage, and three life events. Pure data, shared by `make seed` (scripts/seed.mjs, over HTTP)
// and the first-run card's "load demo ledger". Deterministic noise, so every run draws the same curve.

export type DemoAccount = { name: string; kind: string; currency: string; note: string }
export type Demo = {
  title: string
  accounts: DemoAccount[]
  /** account index → date → balance; the fx is per date (USD→TWD), 1 for TWD accounts */
  balances: { account: number; date: string; amount: number; fx: number }[]
  events: { date: string; title: string }[]
  /** account: index of the liability account the tranches belong to */
  loans: { name: string; principal: number; rate: number; start: string; grace_months: number; total_months: number; account: number }[]
}

const MONTHS = 30
const HOUSE_AT = 12 // the month the house (and mortgage) appear

/** The demo ending on the 15th of `end`'s month (default Sep 2026, what the README screenshots show). English names with `en`. */
export function demoLedger(end = "2026-09-15", en = false): Demo {
  let seed = 42
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1
  const round = (v: number, to: number) => Math.round(v / to) * to
  const [ey, em] = end.split("-").map(Number)
  const dates = Array.from({ length: MONTHS }, (_, i) => new Date(Date.UTC(ey, em - MONTHS + i, 15)).toISOString().slice(0, 10))
  const L = (zh: string, english: string) => (en ? english : zh)

  // Market mood per month: steady growth, a dip around months 16–19, then recovery.
  const mood = dates.map((_, i) => (i >= 16 && i <= 19 ? -0.045 - 0.01 * (i - 16) : 0.012) + rnd() * 0.012)
  const usdTwd = dates.map((_, i) => +(32.1 + 0.9 * Math.sin(i / 5) + rnd() * 0.25).toFixed(3))
  /** Portfolio following `mood`, with monthly contributions of start/100. */
  const compound = (start: number, beta: number) => {
    let v = start
    const path = mood.map((m) => (v = v * (1 + m * beta) + start / 100))
    return (i: number) => path[i]
  }

  // Two tranches on one mortgage: 10M @1.775% 40y with 5 interest-only years; 4M @2.3% 20y.
  const tranches = [
    { name: L("房貸 A・青安", "Mortgage A (youth loan)"), principal: 10_000_000, rate: 0.01775, start: dates[HOUSE_AT], grace_months: 60, total_months: 480 },
    { name: L("房貸 B・一般", "Mortgage B"), principal: 4_000_000, rate: 0.023, start: dates[HOUSE_AT], grace_months: 0, total_months: 240 },
  ]
  const owed = (l: (typeof tranches)[number], months: number) => {
    if (months <= l.grace_months) return l.principal
    const m = l.rate / 12, n = l.total_months - l.grace_months
    const pay = (l.principal * m) / (1 - Math.pow(1 + m, -n))
    let b = l.principal
    for (let k = 0; k < months - l.grace_months; k++) b = b * (1 + m) - pay
    return b
  }

  const specs: (DemoAccount & { from?: number; value: (i: number) => number })[] = [
    { name: L("玉山薪轉", "Salary account"), kind: "bank", currency: "TWD", note: L("薪資戶", "Paycheck"), value: (i) => 320_000 + 18_000 * i + rnd() * 40_000 },
    { name: L("國泰定存", "Time deposit"), kind: "bank", currency: "TWD", note: L("一年期", "One year"), value: (i) => (i < 20 ? 600_000 : 900_000) },
    { name: L("元大證券", "Yuanta brokerage"), kind: "tw_stock", currency: "TWD", note: "0050、2330", value: compound(850_000, 1.9) },
    { name: "Firstrade", kind: "us_stock", currency: "USD", note: "VTI / QQQ", value: compound(22_000, 2.2) },
    { name: L("幣安", "Binance"), kind: "crypto", currency: "USD", note: "", value: compound(3_000, 4) },
    { name: "Toyota Corolla Cross", kind: "movable", currency: "TWD", note: L("2023 年牽車", "Bought 2023"), value: (i) => 780_000 * Math.pow(0.988, i) },
    { name: L("新店自住宅", "Home"), kind: "real_estate", currency: "TWD", note: L("交屋後半年重估一次", "Revalued twice a year"), from: HOUSE_AT, value: (i) => 18_600_000 + 45_000 * (i - HOUSE_AT) },
    { name: L("房貸(土銀)", "Mortgage"), kind: "liability", currency: "TWD", note: L("青安 + 一般,兩段", "Two tranches"), from: HOUSE_AT, value: (i) => tranches.reduce((s, l) => s + owed(l, i - HOUSE_AT), 0) },
  ]

  const balances: Demo["balances"] = []
  specs.forEach((a, k) =>
    dates.forEach((date, i) => {
      const from = a.from ?? 0
      if (i < from || (a.kind === "real_estate" && i > from && (i - from) % 6)) return // the house: revalued twice a year
      const usd = a.currency === "USD"
      balances.push({ account: k, date, amount: round(Math.max(0, a.value(i)), usd ? 1 : 100), fx: usd ? usdTwd[i] : 1 })
    }),
  )
  return {
    title: L("林家帳本", "The Lins' ledger"),
    accounts: specs.map(({ name, kind, currency, note }) => ({ name, kind, currency, note })),
    balances,
    events: [
      { date: dates[5], title: L("換工作,年薪 +25%", "New job, +25% salary") },
      { date: dates[HOUSE_AT], title: L("新店交屋,開始還房貸", "Moved in, mortgage starts") },
      { date: dates[21], title: L("老二出生", "Second child born") },
    ],
    loans: tranches.map((l) => ({ ...l, account: specs.findIndex((a) => a.kind === "liability") })),
  }
}
