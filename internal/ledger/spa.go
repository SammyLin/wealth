package ledger

import (
	"io/fs"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/SammyLin/wealth"
)

// serveSPA serves the Vite build in web/dist. Hashed assets under /assets are immutable;
// every other non-API path gets index.html so client-side routes deep-link. HEAD works too (uptime monitors).
// Without a build (go test, fresh clone) the dist only holds .gitkeep and / explains what to run.
func serveSPA(r *gin.Engine) {
	dist, err := fs.Sub(wealth.Web, "web/dist")
	if err != nil {
		panic(err)
	}
	index, err := fs.ReadFile(dist, "index.html")
	if err != nil {
		index = []byte("<!doctype html><meta charset=utf-8><title>wealth</title><p>Frontend not built. Run <code>cd web && npm ci && npm run build</code>, then restart.")
	}
	files := http.FS(dist)
	r.NoRoute(func(c *gin.Context) {
		p := c.Request.URL.Path
		if m := c.Request.Method; strings.HasPrefix(p, "/api/") || (m != http.MethodGet && m != http.MethodHead) {
			c.Status(http.StatusNotFound)
			return
		}
		if p != "/" {
			if f, err := dist.Open(strings.TrimPrefix(p, "/")); err == nil {
				f.Close()
				if strings.HasPrefix(p, "/assets/") {
					c.Header("Cache-Control", "public, max-age=31536000, immutable")
				}
				c.FileFromFS(p, files)
				return
			}
		}
		c.Header("Cache-Control", "no-cache")
		c.Data(http.StatusOK, "text/html; charset=utf-8", index)
	})
}
