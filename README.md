<div align="center">
  <img src="docs/logo.svg" alt="wealth logo" width="96" />
  <h1>wealth</h1>
  <p><b>A household net-worth ledger that tracks balances, not transactions.</b><br>Update your account balances now and then; see where your net worth is heading.</p>
</div>

<p align="center">
  <a href="https://github.com/SammyLin/wealth/actions/workflows/test.yml"><img alt="test" src="https://github.com/SammyLin/wealth/actions/workflows/test.yml/badge.svg" /></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/github/license/SammyLin/wealth?style=flat-square" /></a>
  <a href="go.mod"><img alt="Go" src="https://img.shields.io/github/go-mod/go-version/SammyLin/wealth?style=flat-square" /></a>
  <a href="#deploy-to-cloudflare-workers"><img alt="Cloudflare Workers" src="https://img.shields.io/badge/Cloudflare_Workers-supported-F38020?style=flat-square" /></a>
  <a href="#self-host"><img alt="Self-host" src="https://img.shields.io/badge/self--host-SQLite-003B57?style=flat-square" /></a>
</p>

<p align="center">
  English | <a href="docs/README.zh-TW.md">繁體中文</a>
</p>

![screenshot](docs/screenshot.png)

> The UI is in English and Traditional Chinese. Amounts can be shown in 萬 (10,000), K / M, or full digits.

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
| **Net-worth trend** | Plotted on real dates, so uneven gaps stay uneven; zoom into a period with the mouse or the keyboard |
| **What changed** | The hero shows which classes moved net worth since the last record, and nudges you about accounts not updated in 90 days |
| **Your own structure** | Account classes are yours: name, color, and liquidity tier (liquid / investments / personal-use / liability). Reorder accounts, add notes |
| **Fast input** | One grid for every account: tab or Enter through it, type `1,234,567` or `12.5萬`, paste a column from a spreadsheet, backfill a past date |
| **Composition** | Stacked chart by asset class, multi-select filter |
| **Balance sheet** | Assets grouped by liquidity = liabilities + net worth, both sides add up |
| **Mortgages** | Principal, rate, start date, grace period, term → monthly payment, payment changes, payoff date |
| **Multi-currency** | Each record stores that day's FX rate, prefilled automatically; configurable base currency |
| **Everything editable** | Ledger name, accounts, every past balance, loans and events can be edited or deleted |
| **Your layout** | Reorder or hide dashboard sections; light / dark / system theme |
| **English & 繁體中文** | UI follows the browser language; switch anytime from the top bar |
| **Import & export** | Import balances from CSV; export a spreadsheet CSV or a CSV that re-imports as is; self-hosted also offers a full `.db` download and daily backups |

## Quick start

**Docker** (nothing else to install):

```sh
git clone https://github.com/SammyLin/wealth.git
cd wealth
cp .env.example .env          # set WEALTH_PASS
docker compose up -d          # http://127.0.0.1:8080, user "me"
```

**From source** needs Go 1.26+ and Node 20+ (the UI is a Vite app that gets embedded into the Go binary):

```sh
git clone https://github.com/SammyLin/wealth.git
cd wealth
make run                      # builds web/, then serves http://127.0.0.1:8080 with data in ./wealth.db
make seed                     # optional, in a second terminal: fill it with demo data
```

`go run ./cmd/wealth` alone also works on a fresh clone (the API runs and `/` explains how to build the UI).

**Dev loop:** `go run ./cmd/wealth` (API on :8080) plus `cd web && npm run dev` (Vite with hot reload on :5173, proxies `/api`), or just `make dev`.

Then:

1. Pick the **base currency** and **amount unit** on the first screen (the base currency locks once you record balances)
2. **Add account**: name, class (bank / TW stocks / US stocks / crypto / personal property / real estate / liability, or your own), currency
3. **Record**: enter current balances; FX rates are filled in for you
4. Come back every so often and update only what changed

## Self-host

A single binary with SQLite on disk, or Docker (data in the `wealth-data` volume; `WEALTH_PASS` comes from `.env`):

```sh
cp .env.example .env && $EDITOR .env   # set WEALTH_PASS
docker compose up -d                  # builds the image on first run
```

```sh
WEALTH_PASS=secret WEALTH_ADDR=:8080 ./wealth   # a password is required on non-localhost addresses
```

| Variable | Default | Meaning |
|---|---|---|
| `WEALTH_DB` | `wealth.db` | SQLite file |
| `WEALTH_ADDR` | `127.0.0.1:8080` | Listen address; `WEALTH_PASS` is required unless it's localhost |
| `WEALTH_USER` / `WEALTH_PASS` | `me` / empty | Basic auth |
| `WEALTH_HOSTS` | empty | Without a password only `localhost` / `127.0.0.1` host names are served (DNS-rebinding guard); list extra names here, comma-separated |
| `WEALTH_BACKUP_DIR` | `backups` | Daily backup, newest 30 kept |

**Bind-mounting a folder instead of the volume:** the container runs as uid 10001, so the folder must be writable by it: `mkdir data && sudo chown 10001 data`, then `- ./data:/data` in `compose.yaml`.

**Behind a reverse proxy:** writes are refused when the browser's `Origin` doesn't match the host the server sees, so the proxy must pass the original host along. nginx's `proxy_pass` sends its upstream address by default; add `proxy_set_header Host $host;` (or `X-Forwarded-Host`, which the server also honours). Caddy (`reverse_proxy 127.0.0.1:8080`) and Traefik keep the host by default.

`GET /healthz` answers `ok` without credentials, for container healthchecks.

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
| `cmd/wealth/server.go` | Self-hosted entry: SQLite, gzip, basic auth, host guard |
| `cmd/wealth/worker.go` | Workers entry: D1, Access verification |
| `internal/ledger/router.go` | Every API route and the write guards (shared by both targets) |
| `internal/ledger/import.go` | CSV balance import |
| `internal/ledger/model.go` | Data types, net-worth series per date, input checks |
| `internal/ledger/store.go` | Settings and loan queries |
| `internal/ledger/fx.go` | Exchange-rate lookup |
| `internal/ledger/loan.go` | Interest-only grace period → level-payment schedule and balance |
| `internal/ledger/access.go` | Cloudflare Access JWT verification |
| `internal/ledger/export.go` | CSV export (spreadsheet layout, and the long layout the import reads) |
| `internal/ledger/backup.go` | Self-hosted .db download and daily backups |
| `internal/ledger/spa.go` | Serves the embedded `web/dist` as a single-page app (immutable hashed assets, `index.html` fallback) |
| `embed.go` | Compiles `web/dist` and `migrations/` into the binary |
| `migrations/` | Schema (shared by both targets); `0002_kinds_layout.sql` adds custom account kinds, account order and notes |
| `web/` | Frontend: Vite + React + TypeScript + [Mantine](https://mantine.dev); one folder per feature under `web/src/features/` (see [web/README.md](web/README.md)) |
| `Dockerfile`, `compose.yaml` | Self-hosted image (Node build → Go build → small Alpine runtime) |

## Contributing

Issues and PRs are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
