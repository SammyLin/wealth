#!/usr/bin/env node
// Seeds a running wealth API with the demo household in src/lib/demo.ts (shared with the first-run card's
// "load demo ledger"). Needs Node 22.18+ (it imports the .ts file directly). No deps.
//   node web/scripts/seed.mjs http://127.0.0.1:8080
//   WEALTH_PASS=secret node web/scripts/seed.mjs   (a password-protected server; WEALTH_USER defaults to "me")
// Idempotent enough for demos: accounts are matched by name, snapshots upsert, events/loans are
// skipped when one with the same name/title already exists.
import { demoLedger } from "../src/lib/demo.ts"

const base = (process.argv[2] || process.env.WEALTH_URL || "http://127.0.0.1:8080").replace(/\/$/, "")
// the same basic auth the server checks (server.go), so `make seed` works against the Docker container too
const auth = process.env.WEALTH_PASS ? { Authorization: "Basic " + Buffer.from(`${process.env.WEALTH_USER || "me"}:${process.env.WEALTH_PASS}`).toString("base64") } : {}

async function api(method, path, body) {
  const r = await fetch(base + path, {
    method,
    headers: { ...auth, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${await r.text()}`)
  return r.status === 204 ? undefined : r.json()
}

async function main() {
  const demo = demoLedger(process.env.DEMO_END, process.env.DEMO_LANG === "en")
  const state = await api("GET", "/api/state")
  const byName = new Map(state.accounts.map((a) => [a.name, a]))
  for (const a of demo.accounts) if (!byName.has(a.name)) byName.set(a.name, await api("POST", "/api/accounts", a))
  const ids = demo.accounts.map((a) => byName.get(a.name).id)
  await api("PUT", "/api/accounts/order", { ids })

  const snapshots = demo.balances.map(({ account, ...s }) => ({ account_id: ids[account], ...s }))
  for (let i = 0; i < snapshots.length; i += 40) await api("POST", "/api/snapshots", snapshots.slice(i, i + 40))

  const titles = new Set(state.events.map((e) => e.title))
  for (const e of demo.events) if (!titles.has(e.title)) await api("POST", "/api/events", e)
  const loanNames = new Set(state.loans.map((l) => l.name))
  for (const { account, ...l } of demo.loans) if (!loanNames.has(l.name)) await api("POST", "/api/loans", { ...l, account_id: ids[account] })

  await api("PUT", "/api/settings", { title: demo.title })
  const after = await api("GET", "/api/state")
  const last = after.series.at(-1)
  console.log(`seeded ${base}: ${after.accounts.length} accounts, ${snapshots.length} snapshots, ${after.events.length} events, ${after.loans.length} loans; net worth ${Math.round(last.total).toLocaleString()} on ${last.date}`)
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
