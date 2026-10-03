# wealth web

The wealth UI: Vite + React 19 + TypeScript + [Mantine](https://mantine.dev) 9. `npm run build` writes `dist/`,
which the Go server embeds (`embed.go`), so the deployed app is a single binary.

```sh
npm ci
npm run dev      # http://localhost:5173, proxies /api to the Go server on :8080 (run `go run ./cmd/wealth` at the repo root)
npm run lint     # oxlint (react, typescript, jsx-a11y)
npm run check    # the *.check.ts self-checks
npm run build    # type-check, then build dist/
```

## Layout

| Path | What |
|---|---|
| `src/main.tsx` | MantineProvider (theme rebuilt per language), modals, notifications |
| `src/theme.ts` | The "paper and ink" theme: palette, fonts, component defaults |
| `src/api/` | `types.ts` mirrors the Go JSON, `client.ts` one function per route, `useLedger.tsx` state + mutations |
| `src/i18n/` | `t()` / `` T`` `` / `useLang()`; shell and server strings in `en.ts` |
| `src/lib/format.ts` | Money in the ledger's unit, dates, percent, amount parsing (`12.5萬`, `1,234`) |
| `src/shell/` | Header, first-run screen, numbered section cards, dashboard layout |
| `src/features/<name>/` | One folder per feature (overview, composition, balance-sheet, accounts, loans, events, settings), each with its own `strings.ts` |

The chart sections (trend, composition, loans) are lazy-loaded, so recharts stays out of the first load.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the translation workflow and conventions.
