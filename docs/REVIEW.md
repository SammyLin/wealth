# Review scores

Six review rounds, two independent reviewers each (A = product/UX reviewer using the app in a browser, B = code reviewer). Scores are 1-10. "open" is the number of unresolved issues after the round.

| Round | Reviewer | Verdict | Overall | first_run | information_design | flexibility | input_speed | mobile | accessibility | i18n | visual | self_host_dx | code_quality | open |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | A | revise | 6.5 | 7 | 7 | 7 | 6 | 7 | 6 | 7 | 8 | 3 | 7 | 10 |
| 1 | B | revise | 5.9 | 6 | 7 | 6 | 7 | 5 | 5 | 6 | 8 | 3 | 6 | 10 |
| 2 | A | revise | 7.6 | 8 | 7 | 8 | 7 | 8 | 7 | 8 | 8 | 7 | 8 | 3 |
| 2 | B | revise | 7.7 | 8 | 8 | 8 | 7 | 8 | 8 | 8 | 8 | 7 | 7 | 3 |
| 3 | A | revise | 7.8 | 8 | 7 | 8 | 8 | 8 | 8 | 9 | 8 | 7 | 7 | 0 |
| 3 | B | revise | 7.8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 7 | 7 | 0 |
| 4 | A | revise | 8.2 | 8 | 8 | 8 | 8 | 9 | 8 | 9 | 9 | 7 | 8 | 1 |
| 4 | B | revise | 8.1 | 8 | 8 | 8 | 9 | 8 | 8 | 8 | 8.5 | 7.5 | 8 | 1 |
| 5 | A | revise | 7.7 | 8 | 8 | 8 | 8 | 8 | 7 | 8 | 8 | 6 | 8 | 2 |
| 5 | B | revise | 7.9 | 8 | 8 | 8 | 9 | 8 | 7 | 8 | 8 | 7 | 8 | 2 |
| 6 | A | revise | 8.5 | 9 | 8 | 9 | 8 | 9 | 8 | 9 | 9 | 9 | 8 | 1 |
| 6 | B | revise | 8.2 | 8 | 8 | 8 | 9 | 8 | 8 | 8 | 8 | 8 | 8 | 0 |

Overall rose from 6.2 (mean of round 1) to 8.4 (round 6). Round 5 dipped because both reviewers counted an uncommitted working tree as a finding; it was committed before round 6. Round 6 is the first round where every dimension scores 8 or more for both reviewers. The ship bar (overall >= 9, every score >= 8, no critical or high finding) was not met: the one high finding of round 6 (a 0.5 BTC holding shown as "1 BTC" in the balance sheet) is fixed in the commit that carries this table; the remaining 22 findings are medium or low and listed below.

## Open after round 6

Medium: importBalances and exportCSV are long handlers that re-load the same data; API errors carry Chinese text as the canonical message (no stable code); TS types are hand-mirrored from Go (no schema); name uniqueness relies on SQLite's ASCII-only lower() with no UNIQUE index; deleteAccount and import apply are not transactional on SQLite; no D1/wasm runtime test and no browser test in CI; the published image and release binaries do not exist until a tag is pushed; new-account picks travel in a query string that can exceed proxy URL limits; Enter on the last foreign row saves before the rate is seen (fixed here for first records); the overwrite confirm focused its close button (fixed here); CSV import has no Undo.

Low: batch caps are not derived from one constant; a kind's liquidity can change under accounts with history; a few cross-request races in patchAccount and loans; validLoan sits in model.go; the runtime image lacks tzdata; the main JS chunk is over 500 kB; the Access JWT check does not verify iss; a new-account fx message is unclear; the stale-account nudge icon wraps at 390px; the trend line shows new accounts as a spike.
