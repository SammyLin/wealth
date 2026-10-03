# Self-hosted image: builds the UI, embeds it into the Go binary, runs as a non-root user with data in /data.
#   docker compose up -d        (see compose.yaml; set WEALTH_PASS in .env first)

FROM node:24-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM golang:1.26-alpine AS server
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/web/dist ./web/dist
# modernc.org/sqlite is pure Go, so the binary is static
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/wealth ./cmd/wealth

FROM alpine:3.22
RUN adduser -D -u 10001 wealth && mkdir /data && chown wealth /data
COPY --from=server /out/wealth /usr/local/bin/wealth
USER wealth
WORKDIR /data
# Listening on all interfaces requires WEALTH_PASS (basic auth); the server refuses to start without it.
ENV WEALTH_DB=/data/wealth.db WEALTH_BACKUP_DIR=/data/backups WEALTH_ADDR=0.0.0.0:8080
EXPOSE 8080
VOLUME /data
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
ENTRYPOINT ["wealth"]
