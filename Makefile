# Local / self-hosted
run:
	go run ./cmd/wealth

test:
	go test ./...

# Cloudflare Workers (Go → WebAssembly + D1). nomsgpack trims gin's unused codecs (~25% smaller).
build-worker:
	go run github.com/syumai/workers-go/cmd/workers-assets-gen -mode=go
	GOOS=js GOARCH=wasm go build -tags nomsgpack -trimpath -ldflags="-s -w" -o build/app.wasm ./cmd/wealth

WRANGLER_CONFIG ?= wrangler.local.jsonc
deploy-worker:
	npx wrangler d1 migrations apply wealth --remote -c $(WRANGLER_CONFIG)
	npx wrangler deploy -c $(WRANGLER_CONFIG)

.PHONY: run test build-worker deploy-worker
