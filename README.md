<div align="center">
  <img src="docs/logo.svg" alt="wealth logo" width="96" />
  <h1>wealth</h1>
  <p><b>只記餘額的家庭資產帳本</b><br>不記每一筆消費,想到時更新帳戶餘額,就看得到淨資產的長期趨勢。</p>
</div>

<p align="center">
  <a href="https://github.com/SammyLin/wealth/actions/workflows/test.yml"><img alt="test" src="https://github.com/SammyLin/wealth/actions/workflows/test.yml/badge.svg" /></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/github/license/SammyLin/wealth?style=flat-square" /></a>
  <a href="go.mod"><img alt="Go" src="https://img.shields.io/github/go-mod/go-version/SammyLin/wealth?style=flat-square" /></a>
  <a href="#部署到-cloudflare-workers"><img alt="Cloudflare Workers" src="https://img.shields.io/badge/Cloudflare_Workers-supported-F38020?style=flat-square" /></a>
  <a href="#自架"><img alt="Self-host" src="https://img.shields.io/badge/self--host-SQLite-003B57?style=flat-square" /></a>
</p>

<p align="center">
  繁體中文 | <a href="docs/README.en.md">English</a>
</p>

![screenshot](docs/screenshot.png)

## 為什麼

記帳 App 大多要你記下每一筆消費。持續記半年的人不多,而真正想知道的通常只是:**我們家的錢,這幾年是變多還是變少?**

wealth 只做這件事。每個帳戶(銀行、證券、房子、房貸)偶爾記一次餘額,其餘交給它:

- **沒更新的帳戶自動沿用上一筆**,不會因為少記一個帳戶,淨資產就像掉下去。
- **外幣照當天匯率換算**,自動抓匯率,美股不會被匯率記成一團亂。
- **大事會畫在圖上**:買房、換工作這類轉折,回頭看曲線時一眼對得上。
- **房貸看得到未來**:寬限期何時結束、月付哪個月會跳、何時繳清。

## 功能

| | |
|---|---|
| **淨資產趨勢** | 曲線按實際日期排,不均勻的記錄間隔不會被拉平;拖曳可放大某段期間 |
| **資產組成** | 各類資產堆疊圖,可複選只看幾類 |
| **資產負債表** | 資產 = 負債 + 淨資產,兩邊合計相等 |
| **房貸** | 本金、利率、撥款日、寬限期、期數 → 每月月付、月付變化、繳清日 |
| **多幣別** | 每筆紀錄存當天匯率,「記一筆」自動帶入;基準幣別可設定 |
| **全部可改** | 帳本名稱、帳戶、過去每筆餘額、貸款、大事都能編輯或刪除 |
| **匯出** | CSV(Excel 直接開);自架版另有完整 `.db` 下載與每日自動備份 |

## 快速開始

需要 Go 1.25+。

```sh
git clone https://github.com/SammyLin/wealth.git
cd wealth
go run ./cmd/wealth
```

打開 http://127.0.0.1:8080:

1. **⚙ 設定**:帳本名稱、基準幣別(開始記帳後就不能改)
2. **新增帳戶**:名稱、類別(銀行/台股/美股/動產/不動產/加密貨幣/負債)、幣別
3. **記一筆**:填各帳戶目前餘額,外幣匯率自動帶入
4. 之後每隔一陣子再「記一筆」,改有變動的帳戶就好

## 自架

單一執行檔 + SQLite,資料存在本機檔案。

```sh
WEALTH_PASS=secret WEALTH_ADDR=:8080 go run ./cmd/wealth   # 對外開放時必須設密碼(basic auth)
```

| 環境變數 | 預設 | 說明 |
|---|---|---|
| `WEALTH_DB` | `wealth.db` | SQLite 檔案 |
| `WEALTH_ADDR` | `127.0.0.1:8080` | 監聽位址;不是本機位址時一定要設 `WEALTH_PASS` |
| `WEALTH_USER` / `WEALTH_PASS` | `me` / 空 | basic auth |
| `WEALTH_BACKUP_DIR` | `backups` | 每天自動備份一份,保留最近 30 份 |

備份請用 SQLite 的線上備份,不要直接 `cp`(WAL 模式下資料可能還在 `-wal` 檔裡):

```sh
sqlite3 wealth.db ".backup wealth-$(date +%F).db"
```

## 部署到 Cloudflare Workers

同一份 Go 程式編成 WebAssembly 跑在 Workers 上([syumai/workers-go](https://github.com/syumai/workers-go)),資料存 D1。

1. `npx wrangler d1 create wealth`,把 `wrangler.jsonc` 複製成 `wrangler.local.jsonc`,填入 database id 和網域。
2. 在 Cloudflare Zero Trust 建一個 Access application 保護這個網域,把團隊網域和 AUD tag 填進 `vars`。
   **Worker 會驗證 Access 的 JWT;沒設定時會拒絕服務**(除非明確設 `ALLOW_PUBLIC=1`)。
3. `make deploy-worker`(套用 migration 並部署)。

> wasm 壓縮後約 6.6 MB,超過 Workers 免費方案的 3 MB 上限,需要 Workers Paid。D1 內建 30 天 Time Travel,可還原到任一時間點。

## 架構

| 檔案 | 內容 |
|---|---|
| `cmd/wealth/server.go` | 自架入口:SQLite、gzip、basic auth |
| `cmd/wealth/worker.go` | Workers 入口:D1、Access 驗證 |
| `internal/ledger/router.go` | 所有頁面與 API 路由(兩種部署共用) |
| `internal/ledger/model.go` | 資料型別、各日期淨值序列、輸入檢查 |
| `internal/ledger/store.go` | 設定與貸款的資料庫讀取 |
| `internal/ledger/fx.go` | 匯率查詢 |
| `internal/ledger/loan.go` | 寬限期只繳息 → 本息平均攤還的月付與餘額計算 |
| `internal/ledger/access.go` | Cloudflare Access JWT 驗證 |
| `internal/ledger/export.go` | CSV 匯出 |
| `internal/ledger/backup.go` | 自架版的 .db 下載與每日備份 |
| `embed.go` | 把 `web/` 和 `migrations/` 編進執行檔 |
| `migrations/` | 資料表(兩種部署共用) |
| `web/index.html` | 前端(單一檔案;Chart.js 捲到圖表時才載入) |
| `web/icons.js` | 用到的 [lucide](https://lucide.dev) 圖示子集,由 `web/mkicons.cjs` 產生 |

## 參與

歡迎 issue 和 PR,開發方式見 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

[MIT](LICENSE)
