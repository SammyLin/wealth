import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// Dev: `npm run dev` here, `go run ./cmd/wealth` at the repo root; /api is proxied to Go.
// Build: `npm run build` → dist/, which embed.go compiles into the binary. emptyOutDir wipes dist/, and
// public/.gitkeep is copied back in, so the tracked dist/.gitkeep (go:embed needs a file on a fresh clone) survives.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  server: { proxy: { "/api": "http://127.0.0.1:8080" } },
  // The chart sections and the dialogs are lazy chunks; what is left in the entry is Mantine itself.
  build: { outDir: "dist", emptyOutDir: true },
})
