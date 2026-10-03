# Contributing

歡迎 issue 和 PR。Issues and pull requests are welcome, in Chinese or English.

## 開發 / Development

Needs Go 1.26+ and Node 20+.

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

`npm run check` runs every `web/src/**/*.check.ts`: small self-checks for the pure logic (amount parsing,
balance-sheet math, CSV preview, loan math, translation conflicts). Node runs them directly, no test framework.

## 原則 / Guidelines

- **Both targets share one router.** Routes go in `internal/ledger/router.go`; only setup that differs lives in `cmd/wealth/server.go` (SQLite) or `cmd/wealth/worker.go` (D1). D1 has no transactions and caps a statement at 100 bound parameters, so keep writes single-statement or chunked.
- **Validate before writing.** A request that fails validation must change nothing. Errors are `400 {error}` in Traditional Chinese; when the message carries values, use `bad(c, status, "還有 {} 個帳戶…", n)` so the UI gets `key` + `params` and can translate it.
- **Schema changes** go in a new file under `migrations/` (`0003_...sql`); never edit an applied one.
- **Money logic needs a test** (see `internal/ledger/loan_test.go`, `model_test.go`, `kinds_test.go`, and the `*.check.ts` files).
- **Frontend layout** (`web/src`): `api/` (types, one fetch helper per route, `useLedger()`), `lib/format.ts` (money, dates, amount parsing), `shell/` (header, section cards, layout), and one folder per feature under `features/`. Use Mantine components; no hand-rolled dialogs, no Tailwind.
- **UI text is bilingual.** Write the Traditional Chinese string and wrap it in `t("…")`, or `` T`…${x}` `` when it interpolates. Add the English to the feature's `strings.ts` (`"還有 {} 個帳戶": "{} account|{} accounts"`: a `|` gives singular and plural). A missing entry falls back to Chinese. All tables share one key space, so the same Chinese key must have the same English everywhere; `npm run check` fails otherwise.
- **No emoji in the UI**; use [lucide](https://lucide.dev) icons (`lucide-react`).
- **Destructive actions** go through `modals.openConfirmModal`; mutations show a notification on failure (`useLedger` does this for you).
- **Never commit real data**: `*.db`, `backups/`, `.env` and `wrangler.local.jsonc` are gitignored for a reason.

## Security

Please report vulnerabilities privately through GitHub's "Report a vulnerability" (Security tab) rather than a public issue.
