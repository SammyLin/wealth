# Contributing

歡迎 issue 和 PR。Issues and pull requests are welcome, in Chinese or English.

## 開發 / Development

```sh
go run ./cmd/wealth            # http://127.0.0.1:8080, data in ./wealth.db
go test ./...
make build-worker   # check the Cloudflare Workers (wasm) build still compiles
```

CI runs `go vet`, `go test` and the wasm build on every push.

## 原則 / Guidelines

- **Both targets share one router.** Routes go in `internal/ledger/router.go`; only setup that differs lives in `cmd/wealth/server.go` (SQLite) or `cmd/wealth/worker.go` (D1). D1 has no transactions and caps a statement at 100 bound parameters, so keep writes single-statement or chunked.
- **Schema changes** go in a new file under `migrations/` (`0002_...sql`); don't edit `0001_init.sql`.
- **Money logic needs a test** (see `internal/ledger/loan_test.go`, `model_test.go`).
- **UI text is bilingual.** Write the Traditional Chinese string, wrap it in `t(...)` (or `` T`...${x}` `` when it interpolates), and add its English to the `EN` table in `web/index.html`. A missing entry falls back to Chinese.
- **Frontend stays one file** (`web/index.html`) with no build step. If you use a new [lucide](https://lucide.dev) icon, regenerate the subset:
  ```sh
  curl -sLo lucide.js https://unpkg.com/lucide@0.469.0/dist/umd/lucide.js
  node web/mkicons.cjs <every icon name used> > web/icons.js
  ```
- **No emoji in the UI**; use lucide icons.
- **Never commit real data**: `*.db`, `backups/` and `wrangler.local.jsonc` are gitignored for a reason.

## Security

Please report vulnerabilities privately through GitHub's "Report a vulnerability" (Security tab) rather than a public issue.
