// Package wealth holds the files compiled into the binary. They live at the repo root
// (web/dist is the Vite build, migrations/ is shared with wrangler's D1 migrations), and an
// embed directive can't reach parent directories, so the embed has to sit here.
package wealth

import "embed"

// Web is the built frontend. `cd web && npm run build` fills it; .gitkeep keeps the
// pattern valid on a fresh clone so `go test` works without Node.
//
//go:embed all:web/dist
var Web embed.FS

// Migrations are applied in file-name order: by wrangler on D1, by ledger.Migrate on SQLite.
//
//go:embed migrations/*.sql
var Migrations embed.FS
