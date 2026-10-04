# What wealth takes from YNAB

YNAB is the best-run product in personal finance: a method with a name, an opinionated data model, and reports that answer one question each. wealth is not a budgeting app, so most of YNAB does not transfer. This note lists what does, what does not, and in which order to build it. Sources: ynab.com (features, pricing, method), support.ynab.com (account types, tracking accounts, loan accounts, targets, Reflect, Age of Money), the Loan Planner launch post.

## The one-line difference

YNAB tracks **every transaction** and assigns cash to categories before it is spent. wealth tracks **balances** and never asks where the money went. YNAB's own docs say the quiet part: for investment, property and loan accounts they recommend *not* linking the bank and instead "reconcile the tracking account to its new balance" by hand, because imports for those accounts are unreliable. Their tracking accounts plus their Net Worth report *is* wealth. We build the whole product around the part of YNAB that YNAB treats as a side feature.

## Borrow

Ordered by value per line of code.

### 1. Loan payoff simulator (P1)

YNAB's Loan Planner: a loan has balance, interest rate (not APR), minimum payment. The simulator lets you try (a) a higher monthly payment, (b) a one-time extra payment, (c) a target payoff date, and shows months shaved and interest saved, on a burndown chart. Their launch post frames every extra dollar as "worth $1.43 against the loan". This is the feature users talk about.

wealth already has the schedule math in `internal/ledger/loan.go` (grace period → level payment → balance by month). Add three inputs on the loan card and recompute: extra per month, one lump sum on a date, target payoff date → required payment. Show payoff date, total interest, interest saved, and overlay the "with extra" line on the existing payment chart. Taiwan-specific win: show what paying extra *during* the 寬限期 does to the jump in month 37.

### 2. Loan-driven liabilities (P1)

In YNAB a loan account accrues interest and moves with each recorded payment; the balance is never stale. In wealth a mortgage balance is a snapshot you must remember to record, and a forgotten liability carries its last balance forward flat, which overstates debt and understates net worth growth.

Change: when a liability account is attached to a loan, the carry-forward for dates with no snapshot follows the loan schedule instead of the last recorded value. A recorded balance still wins (banks round differently). The trend line then moves every month even if the user only records assets. One function in `model.go` where the series is built, plus a note on the account ("餘額依房貸時間表推算").

### 3. Targets, reduced to one (P2)

YNAB targets live on categories (set aside X monthly, have a balance of Y by date, refill up to Z) and the mobile Home tab shows one "Current Goal". We have no categories, but we have the hero number.

Change: one net-worth target per ledger: amount + date, optional. The hero shows a progress bar and the projected date at the current 12-month pace (linear fit of the series, same number the hero already prints as 平均每年). Phrase it the YNAB way, as a sentence: "照近一年的速度,2031 年 3 月到 1 億". No target types, no repeat cadence; one goal is the whole feature. Later: a second kind of target on a liquidity tier ("流動資產 ≥ 300 萬").

### 4. Net worth report filters and table (P2)

YNAB's Net Worth report is a monthly bar chart of assets vs debts with a net-worth line, filterable by account type or a single account, with a table of assets / debts / net worth / change per month, and export.

We have the trend (by date, which is better than monthly) and a stacked composition chart with a class filter. Add: the same class and account filter on the trend; a month-by-month table under the trend with assets, liabilities, net worth, change, and change % (the existing 以表格顯示 toggle is the place); CSV export of that table (the export route exists).

### 5. Update cadence per account (P3)

YNAB's "reconcile" button and "last reconciled" date are the same gesture as 記一筆. We already nudge after 90 days. Make the cadence a per-account setting (monthly / quarterly / yearly / never; default follows the class: bank monthly, property yearly), show "上次 2026.06.15 · 季更" on the account, and let the nudge use it. Cheap, and it removes the single most common annoyance (a house nagging every 90 days).

### 6. One number, like Age of Money (P3)

Age of Money is YNAB's single behavioural metric: average days between earning and spending. It only works with transactions. Our equivalent that needs one input: **runway**, liquid assets ÷ monthly household spending, shown as "流動資產可撐 14 個月". Monthly spending is one settings field (optional). Without it the tile is hidden. This also gives the liquidity bar a reason to exist beyond percentages.

### 7. Sharing in the base product (phase 3, pricing)

YNAB Together: up to 5 collaborators on one subscription at no extra cost, per-plan sharing, and they market it as the family feature. Our roadmap already has `ledger_members` and a viewer role. Decision to record: a partner seat is part of the single household price, never an upsell. Reference price point: YNAB is USD 109/year; a balance-only tool should sit well under that.

### 8. Copy, not features

- Lead with the question, not the tool: YNAB's hero is "Do you worry about money?". Ours: 「你知道家裡的錢是變多還是變少嗎?」 Already used in the launch post; apply to the README intro and the first-run screen.
- Name the method so it can be repeated: 記餘額 · 標大事 · 看趨勢. Three habits, same role as YNAB's five pillars.
- Promise the time cost: YNAB says 20 minutes to start; we can say 一個月五分鐘.
- Frame the pain as the app's fault, not the user's. YNAB calls bad money habits "a skill gap"; our line is 「不是你不會記帳,是 app 要得太多」.

## Do not borrow

- Categories, envelopes, "Ready to Assign". The product exists because people quit that.
- A transaction register. The moment we store transactions we are a worse YNAB.
- Credit card accounts as a special type. A card is a liability balance like any other.
- Bank sync. Taiwan has no open-banking API worth building on, and YNAB itself steers investment and loan accounts away from linking. Our CSV import plus 記一筆 is the honest version.
- Age of Money itself, spending breakdown, spending trends, income v expense. All need transactions.

## Aside: "Sofi AI vs YNAB"

The sofi.cash post is Sofi AI's own marketing written as a review (byline claims YNAB experience; feature table, giveaway CTA). Their pitch: AI reads receipts and bank emails so you never type a transaction. For wealth the only transferable idea is input friction: a future "paste a screenshot of your bank app, we read the balance" would cut 記一筆 to seconds. Low priority; the grid is already fast.

## Order of work

| # | Item | Touches | Size |
|---|------|---------|------|
| 1 | Loan payoff simulator | `loan.go`, loans feature UI | M |
| 2 | Loan-driven liability carry-forward | `model.go` series, account note | S |
| 3 | One net-worth target + projected date | settings key, hero | S |
| 4 | Trend filter + monthly table + export | overview feature, `export.go` | M |
| 5 | Per-account update cadence | accounts schema (one column), nudge | S |
| 6 | Runway tile (monthly spending setting) | settings key, hero | S |
| 7 | Partner seat in base price | roadmap phase 3 decision | — |
| 8 | Question-first copy, named method | README, first-run card | S |

Items 1–3 are the release after the current one. 4–6 fill the one after. 7–8 are decisions, write them down now.
