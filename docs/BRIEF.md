# wealth v2 — build brief

Shared contract for everyone working on the v2 UI. Read fully before touching code.

## Product

A household **net-worth ledger that tracks balances, not transactions**. You record a balance per account whenever you remember; the app carries forgotten accounts forward, converts currencies at that day's rate, draws life events on the trend, and projects mortgages. Target: the best-in-class open-source product in its category, self-hostable in one command, and ready to grow into a hosted SaaS.

What makes v2 different from v1 (the single-file UI in git history, `git show 863fadc:web/index.html`):

1. **Flexible structure.** Account classes (kinds) are user-defined: name, color, liquidity tier (liquid / invest / fixed / liability). Accounts can be reordered and carry a note. Liabilities are whatever the user says they are.
2. **Flexible input.** Record balances per date in a fast grid (tab through, paste numbers like `1,234,567` or `12.5萬`), import balances from CSV, edit any past balance inline.
3. **Flexible layout.** Dashboard sections can be reordered and hidden; display unit (萬 / K / full) and language are user settings; light/dark follows the system or a toggle.
4. **Mantine UI.** Everything is Mantine components (`@mantine/core`, `form`, `charts`, `dates`, `modals`, `notifications`). No hand-rolled dialogs, no Tailwind, no emoji in UI chrome (lucide-react icons only).

## Stack and layout

```
web/                       Vite + React 19 + TypeScript + Mantine 9
  src/main.tsx             MantineProvider / ModalsProvider / Notifications (done)
  src/theme.ts             createTheme(...) — palette, fonts, component defaults
  src/index.css            Mantine style imports + global tweaks only
  src/api/types.ts         TS types mirroring the Go JSON (see API below)
  src/api/client.ts        fetch helpers: getState, putSettings, ... one function per route
  src/api/useLedger.tsx    LedgerProvider + useLedger(): {state, loading, error, refresh, ...mutations}
  src/i18n/index.ts        t(zh) / T`...` + useLang(); EN table merged from import.meta.glob('../features/*/strings.ts')
  src/lib/format.ts        money (unit-aware), dates, percent
  src/shell/               AppHeader, SectionCard, section registry, LayoutEditor hooks
  src/features/<name>/     one folder per feature (below); each exports a default component
                           and optionally strings.ts  (export const en: Record<string,string>)
internal/ledger/           Go API shared by SQLite (self-host) and D1 (Workers)
migrations/0002_*.sql      schema additions (never edit 0001)
```

Dev loop: `go run ./cmd/wealth` (API on :8080) + `cd web && npm run dev` (HMR on :5173, proxies `/api`). Checks: `cd web && npm run lint && npm run build`, `go vet ./... && go test ./...`, wasm: `GOOS=js GOARCH=wasm go build -tags nomsgpack -o /dev/null ./cmd/wealth`.

## Design direction

Keep v1's editorial "paper and ink" identity; it is the brand. Implement it through the Mantine theme, not ad-hoc CSS.

- Light palette: paper `#f5efe3`, paper-2 `#ede4d2`, card `#fbf8f1`, ink `#1f1a14`, ink-2 `#4a4237`, ink-3 `#6f6556`, rule `#e3d8c4`, gold `#7d5803`, gold-2 `#ca8a04`, up `#2d6a39`, down `#a3302a`. Dark palette: derive (deep warm charcoal, parchment text, same gold). Set these via `theme.colors` (a `gold` tuple as `primaryColor`) and `cssVariablesResolver` for body/card backgrounds in both schemes.
- Type: headings serif (`"GenRyuMinTW","Noto Serif TC",Georgia,serif`), numbers `Fraunces,Georgia,serif` with `font-variant-numeric: tabular-nums`, body `"MiSansTC","Noto Sans TC",system-ui,sans-serif`. Fonts load from `https://fonts.googleapis.com` and `https://font.emtech.cc` as in v1 (non-blocking). Radius `md`, soft shadow.
- Kind colors (defaults, user-editable): bank `#2a78d6`, tw_stock `#eb6834`, us_stock `#1baf7a`, movable `#eda100`, real_estate `#e87ba4`, crypto `#4a3aa7`, liability `#e34948`.
- Layout: `AppShell` with a sticky header (brand, language toggle, color-scheme toggle, Settings, primary button 記一筆). Main is a `Container size="lg"` of numbered `SectionCard`s in the user's order. Hero = net worth, change since last record, liquidity bar.
- Mobile first: every table collapses or scrolls; dialogs become full-screen `Modal fullScreen` under `sm`.
- Empty states and loading skeletons for every section. Every destructive action goes through `modals.openConfirmModal`. Every mutation shows a notification on failure.
- Accessibility: labels on every input, focus management in modals is Mantine's, charts have `aria-label` summaries, color is never the only signal (kind chips show the name).

## Language

UI strings are written in Traditional Chinese and wrapped: `t('淨資產')`, or `` T`截至 ${d}` `` when interpolating. English lives in each feature's `strings.ts` (`export const en = { '淨資產': 'Net worth' }`). A missing entry falls back to Chinese. `useLang()` returns `{lang, setLang}`; default follows `navigator.language`, persisted in `localStorage['lang']`. Amount formatting respects `settings.unit`.

## Backend contract (migration 0002 + API)

### Schema additions (`migrations/0002_kinds_layout.sql`)

```sql
CREATE TABLE IF NOT EXISTS account_kinds (
  key TEXT PRIMARY KEY,                     -- ^[a-z][a-z0-9_]{1,31}$
  name TEXT NOT NULL,
  color TEXT NOT NULL,                      -- #rrggbb
  liquidity TEXT NOT NULL,                  -- 'liquid' | 'invest' | 'fixed' | 'liability'
  sort INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO account_kinds VALUES
  ('bank','銀行','#2a78d6','liquid',0), ('tw_stock','台股','#eb6834','invest',1),
  ('us_stock','美股','#1baf7a','invest',2), ('crypto','加密貨幣','#4a3aa7','invest',3),
  ('movable','動產','#eda100','fixed',4), ('real_estate','不動產','#e87ba4','fixed',5),
  ('liability','負債','#e34948','liability',6);
ALTER TABLE accounts ADD COLUMN sort INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN note TEXT NOT NULL DEFAULT '';
```

D1 rules: no transactions, ≤100 bound parameters per statement; keep writes single-statement or chunked (see `/api/snapshots`).

### JSON shapes

```ts
type Liquidity = 'liquid' | 'invest' | 'fixed' | 'liability'
type Kind     = { key: string; name: string; color: string; liquidity: Liquidity; sort: number }
type Account  = { id: number; name: string; kind: string; currency: string; archived: boolean;
                  sort: number; note: string; amount: number; fx: number; history: Point[] }
type Point    = { date: string; value: number; amount: number; fx: number }   // value = amount*fx (base ccy)
type Row      = { date: string; total: number; by_kind: Record<string, number> } // liabilities negative
type Event    = { id: number; date: string; title: string }
type Loan     = { id: number; account_id: number | null; name: string; principal: number; rate: number;
                  start: string; grace_months: number; total_months: number }
type LoanView = Loan & { grace_end: string; payment_now: number; grace_payment: number;
                         level_payment: number; balance_now: number; end_date: string }
type Sched    = { month: string; total: number; by: Record<string, number> }
type Settings = { title: string; subtitle: string; base_currency: string;
                  unit: 'wan' | 'k' | 'full'; layout: string /* JSON Layout */ }
type Layout   = { sections: { id: 'trend'|'mix'|'sheet'|'loans'|'events'; hidden: boolean }[] }
type State    = { file_backups: boolean; settings: Settings; kinds: Kind[]; accounts: Account[];
                  series: Row[]; events: Event[]; loans: LoanView[]; loan_schedule: Sched[] }
```

### Routes

| Route | Body / notes |
|---|---|
| `GET /api/state` | `State` above. `kinds` sorted by `sort,key`; `accounts` by `sort,id`. |
| `PUT /api/settings` | partial `Settings`; new keys `unit` (enum) and `layout` (valid JSON ≤ 4 KB). `base_currency` still locked once snapshots exist. |
| `POST /api/kinds` | `{key,name,color,liquidity,sort}` → 201 `Kind`. 409 if key exists. |
| `PUT /api/kinds/:key` | `{name,color,liquidity,sort}` (key immutable) → `Kind` |
| `DELETE /api/kinds/:key` | 409 `{error}` if any account uses it |
| `POST /api/accounts` | `{name,kind,currency,note?}`; `kind` must exist in `account_kinds` (replaces the hard-coded map) |
| `PATCH /api/accounts/:id` | any of `name, currency, archived, kind, sort, note` |
| `PUT /api/accounts/order` | `{ids:number[]}` → sets `sort` = index (chunk ≤ 50 ids per statement) |
| `DELETE /api/accounts/:id` | unchanged |
| `POST /api/snapshots` / `DELETE /api/snapshots` | unchanged |
| `POST /api/import` | `text/csv`: header `date,account,amount,fx`; `account` by exact name (404-style 400 listing unknown names); `fx` optional → looked up like the UI does. Upserts like `/api/snapshots`. Returns `{imported:n}`. |
| events / loans / export.csv / fx | unchanged |

`series()` decides sign from the kind's `liquidity == 'liability'`, not from the key `liability`. `exportCSV` reads kind names from `account_kinds` instead of `kindLabel`. All validation errors return `400 {error: "<Traditional Chinese message>"}`.

## Feature folders and owners

| Folder | Component | Covers |
|---|---|---|
| `features/overview` | `Overview` | Hero (net worth, delta vs previous record, liquidity bar), trend `LineChart` on real dates with event reference lines and zoom/brush, period presets |
| `features/composition` | `Composition` | Stacked `AreaChart` by kind, multi-select kind filter chips, latest-mix donut |
| `features/balance-sheet` | `BalanceSheet`, `RecordModal` | Assets grouped by liquidity tier = liabilities + net worth; collapsible groups; per-account latest balance, currency, fx; **記一筆** modal: date picker, grid of accounts with smart number parsing, fx prefill via `/api/fx`, live preview of new total |
| `features/accounts` | `AccountsManager`, `KindsManager` | Add/edit/archive/delete/reorder accounts (drag or up/down), edit history table of one account; kinds CRUD with color swatch + liquidity select; guard deletes in use |
| `features/loans` | `Loans`, `LoanModal` | Mortgage cards (payment now, next change, payoff), monthly payment `BarChart` to payoff, this month's payments grouped by mortgage |
| `features/events` | `Events`, `EventModal` | Timeline list, add/edit/delete |
| `features/settings` | `SettingsDrawer`, `ImportExport` | Ledger title/subtitle, base currency (locked note), unit, language, color scheme, **layout editor** (reorder + show/hide sections, saved to `settings.layout`), export CSV / download .db (if `file_backups`), import CSV with preview |

Rules for feature agents: only create or edit files inside your folder (plus your `strings.ts`). Use `useLedger()` for data and mutations, `t()` for strings, `fmtMoney()` from `lib/format`. If you need a shared helper that does not exist, put it in your folder and note it in your report. Don't add npm dependencies.
