<div align="center">
  <img src="logo.svg" alt="wealth logo" width="96" />
  <h1>wealth</h1>
  <p><b>A household net-worth ledger that tracks balances, not transactions.</b><br>Update your account balances now and then; see where your net worth is heading.</p>
</div>

<p align="center">
  <a href="https://github.com/SammyLin/wealth/actions/workflows/test.yml"><img alt="test" src="https://github.com/SammyLin/wealth/actions/workflows/test.yml/badge.svg" /></a>
  <a href="../LICENSE"><img alt="License: MIT" src="https://img.shields.io/github/license/SammyLin/wealth?style=flat-square" /></a>
  <a href="../go.mod"><img alt="Go" src="https://img.shields.io/github/go-mod/go-version/SammyLin/wealth?style=flat-square" /></a>
  <a href="#deploy-to-cloudflare-workers"><img alt="Cloudflare Workers" src="https://img.shields.io/badge/Cloudflare_Workers-supported-F38020?style=flat-square" /></a>
  <a href="#self-host"><img alt="Self-host" src="https://img.shields.io/badge/self--host-SQLite-003B57?style=flat-square" /></a>
</p>

<p align="center">
  <a href="../README.md">繁體中文</a> | English
</p>

![screenshot](screenshot.png)

> The UI is in Traditional Chinese and amounts are shown in 萬 (10,000) units. Contributions for other languages are welcome.

## Why

Most budgeting apps want every single expense. Few people keep that up for long, and the question most households actually have is simpler: **is our money growing or shrinking over the years?**

wealth answers just that. Record a balance for each account (bank, brokerage, house, mortgage) whenever you remember, and it does the rest:

- **Accounts you skip carry their last balance forward**, so forgetting one account doesn't look like a crash.
- **Foreign currencies use that day's rate**, fetched automatically.
- **Life events are drawn on the chart** (buying a house, a new job), so turns in the curve explain themselves.
- **Mortgages show the future**: when the interest-only period ends, which month the payment jumps, when it's paid off.

## Features

| | |
|---|---|
| **Net-worth trend** | Plotted on real dates, so uneven gaps stay uneven; drag to zoom into a period |
| **Composition** | Stacked chart by asset class, multi-select filter |
| **Balance sheet** | Assets = liabilities + net worth, both sides add up |
| **Mortgages** | Principal, rate, start date, grace period, term → monthly payment, payment changes, payoff date |
| **Multi-currency** | Each record stores that day's FX rate, prefilled automatically; configurable base currency |
| **Everything editable** | Ledger name, accounts, every past balance, loans and events can be edited or deleted |
| **Export** | CSV (opens in Excel); self-hosted also offers a full `.db` download and daily backups |

## Quick start

Requires Go 1.25+.

```sh
git clone https://github.com/SammyLin/wealth.git
cd wealth
go run .
```

Open http://127.0.0.1:8080:

1. **⚙ Settings**: ledger name and base currency (locked once you record balances)
2. **新增帳戶 (add account)**: name, kind (bank / TW stocks / US stocks / movable / real estate / crypto / liability), currency
3. **記一筆 (record)**: enter current balances; FX rates are filled in for you
4. Come back every so often and update only what changed

## Self-host

A single binary with SQLite on disk.

```sh
WEALTH_PASS=secret WEALTH_ADDR=:8080 go run .   # a password is required on non-localhost addresses
```

| Variable | Default | Meaning |
|---|---|---|
| `WEALTH_DB` | `wealth.db` | SQLite file |
| `WEALTH_ADDR` | `127.0.0.1:8080` | Listen address; `WEALTH_PASS` is required unless it's localhost |
| `WEALTH_USER` / `WEALTH_PASS` | `me` / empty | Basic auth |
| `WEALTH_BACKUP_DIR` | `backups` | Daily backup, newest 30 kept |

Back up with SQLite's online backup, never `cp` (in WAL mode recent data may still be in the `-wal` file):

```sh
sqlite3 wealth.db ".backup wealth-$(date +%F).db"
```

## Deploy to Cloudflare Workers

The same Go code compiles to WebAssembly and runs on Workers ([syumai/workers-go](https://github.com/syumai/workers-go)), with data in D1.

1. `npx wrangler d1 create wealth`, copy `wrangler.jsonc` to `wrangler.local.jsonc`, fill in the database id and your domain.
2. In Cloudflare Zero Trust, create an Access application for that domain and put the team domain and AUD tag in `vars`.
   **The Worker verifies the Access JWT and refuses to serve without it** (unless you explicitly set `ALLOW_PUBLIC=1`).
3. `make deploy-worker` (applies migrations, then deploys).

> The wasm is about 6.6 MB gzipped, above the Workers free plan's 3 MB limit, so Workers Paid is required. D1 Time Travel can restore any point in the last 30 days.

## Architecture

| File | What it holds |
|---|---|
| `app.go` | Every page and API route (shared by both targets) |
| `server.go` | Self-hosted entry: SQLite, gzip, basic auth, daily backups |
| `worker.go` | Workers entry: D1, Access verification |
| `loan.go` | Interest-only grace period → level-payment schedule and balance |
| `access.go` | Cloudflare Access JWT verification |
| `export.go` | CSV export |
| `migrations/` | Schema (shared by both targets) |
| `web/index.html` | Frontend (single file; Chart.js loads when a chart scrolls into view) |
| `web/icons.js` | Subset of [lucide](https://lucide.dev) icons, generated by `web/mkicons.cjs` |

## Contributing

Issues and PRs are welcome. See [CONTRIBUTING.md](../CONTRIBUTING.md).

## License

[MIT](../LICENSE)
