import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// Dev: `npm run dev` here, `go run ./cmd/wealth` at the repo root; /api is proxied to Go.
// Build: `npm run build` → dist/, which embed.go compiles into the binary.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  server: { proxy: { "/api": "http://127.0.0.1:8080" } },
  build: { outDir: "dist", emptyOutDir: true },
})
