# Local / self-hosted. The UI is a Vite app in web/; its build is embedded into the Go binary.
run: web
	go run ./cmd/wealth

dev:            # Go API on :8080 + Vite dev server with HMR on :5173 (proxies /api)
	trap 'kill 0' EXIT; go run ./cmd/wealth & cd web && npm run dev

# npm ci only when package-lock.json is newer than the last install
web: web/node_modules/.package-lock.json
	cd web && npm run build

web/node_modules/.package-lock.json: web/package-lock.json | node-version
	cd web && npm ci

# npm run check runs the .ts checks with node --test directly: Node 22.18+ strips types by default
node-version:
	@node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<22||(a===22&&b<18)) { console.error("Node 22.18+ is needed (found "+process.version+"): web/package.json engines"); process.exit(1) }'

test: node-version
	test -z "$$(gofmt -l .)" || { gofmt -l .; exit 1; }
	go vet ./...
	go test ./...
	cd web && npm run lint && npm run check && npm run build

seed:           # demo data into a running server (make run first); WEALTH_URL overrides the address, WEALTH_PASS / WEALTH_USER log in
	node web/scripts/seed.mjs $${WEALTH_URL:-http://127.0.0.1:8080}

# Cloudflare Workers (Go → WebAssembly + D1). nomsgpack trims gin's unused codecs (~25% smaller).
build-worker: web
	go run github.com/syumai/workers-go/cmd/workers-assets-gen -mode=go
	GOOS=js GOARCH=wasm go build -tags nomsgpack -trimpath -ldflags="-s -w" -o build/app.wasm ./cmd/wealth

WRANGLER_CONFIG ?= wrangler.local.jsonc
deploy-worker:
	npx wrangler d1 migrations apply wealth --remote -c $(WRANGLER_CONFIG)
	npx wrangler deploy -c $(WRANGLER_CONFIG)

.PHONY: run dev web test seed build-worker deploy-worker node-version
