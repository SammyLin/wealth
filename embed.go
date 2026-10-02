// Package wealth holds the files compiled into the binary. They live at the repo root
// (web/ is the UI, migrations/ is shared with wrangler's D1 migrations), and go:embed
// can't reach parent directories, so the embed has to sit here.
package wealth

import "embed"

//go:embed web/index.html web/icons.js
var Web embed.FS

//go:embed migrations/0001_init.sql
var Schema string
