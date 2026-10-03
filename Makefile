# Local / self-hosted. The UI is a Vite app in web/; its build is embedded into the Go binary.
run: web
	go run ./cmd/wealth

dev:            # Go API on :8080 + Vite dev server with HMR on :5173 (proxies /api)
	go run ./cmd/wealth & cd web && npm run dev; kill %1

web:
	cd web && npm ci && npm run build

test:
	go test ./...
	cd web && npm run build

# Cloudflare Workers (Go → WebAssembly + D1). nomsgpack trims gin's unused codecs (~25% smaller).
build-worker: web
	go run github.com/syumai/workers-go/cmd/workers-assets-gen -mode=go
	GOOS=js GOARCH=wasm go build -tags nomsgpack -trimpath -ldflags="-s -w" -o build/app.wasm ./cmd/wealth

WRANGLER_CONFIG ?= wrangler.local.jsonc
deploy-worker:
	npx wrangler d1 migrations apply wealth --remote -c $(WRANGLER_CONFIG)
	npx wrangler deploy -c $(WRANGLER_CONFIG)

.PHONY: run dev web test build-worker deploy-worker
