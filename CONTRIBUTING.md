# Contributing

歡迎 issue 和 PR。Issues and pull requests are welcome, in Chinese or English.

## 開發 / Development

Needs Go 1.26+ and Node 22.18+.

```sh
cd web && npm ci && cd ..
make dev            # Go API on :8080 + Vite with hot reload on http://localhost:5173 (proxies /api)
make seed           # demo data into the running server
```

Before a PR, run what CI runs:

```sh
go vet ./... && go test ./...                 # works on a fresh clone, without Node
cd web && npm run lint && npm run check && npm run build
GOOS=js GOARCH=wasm go build -tags nomsgpack -o /dev/null ./cmd/wealth   # the Workers build
```

`npm run check` runs every `web/src/**/*.check.ts` with Node's built-in test runner (`node --test`, `node:assert`;
no test dependency): small checks for the pure logic (amount parsing, balance-sheet math, chart ticks, loan math,
translation conflicts, missing English, Chinese text written into JSX without `t()`). Logic that exists in both Go
and TypeScript (amount parsing, loan payments, month arithmetic, loan validation) is tested against the same cases
in `internal/ledger/testdata/*.json`, so the two can't drift. CSV parsing has one implementation, the server's: the
UI previews an import with `POST /api/import?dry_run=1`.

There are no browser tests in CI yet, so a UI change also gets this smoke run by hand on a fresh database
(`WEALTH_DB=/tmp/smoke.db WEALTH_ADDR=127.0.0.1:18345 go run ./cmd/wealth`, then `make seed WEALTH_URL=…` for data):

1. First run: base currency and unit, **Add account**. Type a name, Tab to *Class*, type `Lia` and press Enter: the
   class must become *Liabilities* (a half-typed class must never submit the form with the old one).
2. **Record**: type a balance, Enter through the rows, save; the toast's **Undo** removes the batch.
3. **Import from CSV** with a new account whose `kind` cell is `台股`: it is preset to the stocks class; an unknown
   kind cell shows "not found, using …" next to its picker.
4. Edit a past balance in an account's history: Enter or leaving the row saves it, with Undo.
5. Switch language and color scheme; check a phone width (Mantine `sm`, 48em) for horizontal scrolling.

## 原則 / Guidelines

- **Both targets share one router.** The route table is `internal/ledger/router.go`, with one file of handlers per resource (`accounts.go`, `kinds.go`, `snapshots.go`, `events.go`, `loans.go`, `settings.go`, `state.go`); only setup that differs lives in `cmd/wealth/server.go` (SQLite) or `cmd/wealth/worker.go` (D1). D1 has no transactions and caps a statement at 100 bound parameters, so keep writes single-statement or chunked.
- **Validate before writing.** A request that fails validation must change nothing. Errors are `400 {error}` in Traditional Chinese; when the message carries values, use `bad(c, status, "還有 {} 個帳戶…", n)` so the UI gets `key` + `params` and can translate it.
- **Schema changes** go in a new file under `migrations/` (`0003_...sql`); never edit an applied one.
- **Money logic needs a test** (see `internal/ledger/loan_test.go`, `model_test.go`, `kinds_test.go`, and the `*.check.ts` files).
- **Frontend layout** (`web/src`): `api/` (types, one fetch helper per route, `useLedger()`), `lib/format.ts` (money, dates, amount parsing), `shell/` (header, section cards, layout), and one folder per feature under `features/`. Use Mantine components; no hand-rolled dialogs, no Tailwind.
- **UI text is bilingual.** Write the Traditional Chinese string and wrap it in `t("…")`, or `` T`…${x}` `` when it interpolates. Add the English to the feature's `strings.ts` (`"還有 {} 個帳戶": "{} account|{} accounts"`: a `|` gives singular and plural). A missing entry falls back to Chinese. All tables share one key space, so the same Chinese key must have the same English everywhere; `npm run check` fails otherwise.
- **No emoji in the UI**; use [lucide](https://lucide.dev) icons (`lucide-react`).
- **Destructive actions** go through `modals.openConfirmModal`; mutations show a notification on failure (`useLedger` does this for you).
- **Never commit real data**: `*.db`, `backups/`, `.env` and `wrangler.local.jsonc` are gitignored for a reason.

## Releases

Push a `v*` tag (`v2.0.0`; `v2.0.0-rc1` is a pre-release). `.github/workflows/release.yml` runs `test.yml` first,
then uploads four tarballs plus `SHA256SUMS` to the GitHub release and pushes the multi-arch image to
`ghcr.io/sammylin/wealth`. Run it from the Actions tab (workflow_dispatch) to build everything without
publishing. **After the first release, make the GHCR package public** (Packages → wealth → Package settings →
Change visibility): GHCR creates it private, and `docker compose up` can't pull a private image without a login.

## Security

Please report vulnerabilities privately through GitHub's "Report a vulnerability" (Security tab) rather than a public issue.
