# Roadmap: from self-host to SaaS

Each phase keeps the self-host single binary working; the hosted product is the same code with more tenants.

## Phase 1 — this release (single ledger)

Self-host (SQLite) and Workers (D1) share one router. Custom kinds, account order, layout and unit settings, CSV import, Mantine UI. Schema: `0001_init`, `0002_kinds_layout`.

## Phase 1.5 — what YNAB does better

Loan payoff simulator, loan-driven liability carry-forward, one net-worth target with a projected date, trend filters and a monthly table, per-account update cadence, a runway number. Reasoning and order in [YNAB-REFERENCE.md](YNAB-REFERENCE.md). None of it needs schema beyond one column on `accounts` (cadence) and two settings keys.

## Phase 2 — multi-tenant

- **Schema (`0003_ledgers.sql`)**: `ledgers(id, name, base_currency, created_at)`; add `ledger_id INTEGER NOT NULL` to `accounts`, `account_kinds`, `snapshots`, `events`, `loans`; `settings` becomes `(ledger_id, key, value)`. Backfill everything to ledger 1. Primary keys of `account_kinds` become `(ledger_id, key)`; indexes lead with `ledger_id`.
- **Auth**: Cloudflare Access email (already verified in `access.go`) or generic OIDC. A middleware resolves the caller to a `users` row and to a `ledger_members(ledger_id, user_id, role)` row, then puts `ledger_id` in the request context. Self-host basic auth maps to ledger 1.
- **API**: no path changes; every query in the per-resource handler files (`accounts.go`, `snapshots.go`, …) and `store.go` takes `ledger_id` from context (one helper, so no handler reads it from the client). New `GET/POST /api/ledgers` and an `X-Ledger` header (or `/l/:id/api/...`) to switch.
- **Settings**: per-ledger already (title, base currency, unit, layout); language and color scheme stay per-browser.
- **Tests**: a cross-tenant test per route (ledger A can never read or write ledger B).

## Phase 3 — hosted

- **Billing**: `plans`, `subscriptions(user_id, provider_ref, status, period_end)`; Stripe webhook route; limits enforced in the write guards (accounts per ledger, ledgers per user).
- **Sharing**: `invites(token, ledger_id, role, expires_at)`; role `viewer` makes every write route return 403, so a partner can see the ledger read-only.
- **Scheduled FX refresh**: Workers cron trigger fills `fx_rates(date, currency, rate)` daily; `/api/fx` reads the table first and only falls back to the live lookup.
- **Email digest**: monthly cron renders net worth, change, and stale accounts (>90 days) per ledger; `users.digest` opt-in flag, sent through a transactional email API.
- **Ops**: per-ledger export on account deletion; D1 Time Travel as the backup story.
