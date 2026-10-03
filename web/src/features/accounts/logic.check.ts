// Self-check, not bundled: `node src/features/accounts/logic.check.ts` (Node 22.18+ strips the types); `npm run check` runs every *.check.ts with node --test.
import assert from "node:assert/strict"
import { KEY_RE, moved, slugKey, staleSearch } from "./logic.ts"

assert.deepStrictEqual(slugKey("Gold ETF", []), "gold_etf")
assert.deepStrictEqual(slugKey("Épargne 2", []), "epargne_2")
assert.deepStrictEqual(slugKey("保險", []), "kind")
assert.deepStrictEqual(slugKey("保險", ["kind", "kind_2"]), "kind_3")
assert.deepStrictEqual(slugKey("退休金", ["invest"], "invest"), "invest_2")
assert.deepStrictEqual(slugKey("401k plan", []), "k_plan")
assert.deepStrictEqual(slugKey("bank", ["bank"]), "bank_2")
for (const name of ["Gold ETF", "保險", "x", "a".repeat(80), "9_9", "__A__"]) assert.deepStrictEqual(KEY_RE.test(slugKey(name, [])), true)
assert.deepStrictEqual(KEY_RE.test(slugKey("a".repeat(40), ["a".repeat(28)])), true)
assert.deepStrictEqual(moved([1, 2, 3], 0, 1), [2, 1, 3])
assert.deepStrictEqual(moved([1, 2, 3], 2, 3), [1, 2, 3])
assert.deepStrictEqual(moved([1, 2, 3], 0, -1), [1, 2, 3])
assert.deepStrictEqual(moved([1, 2, 3, 4], 3, 0), [4, 1, 2, 3]) // move to top
assert.deepStrictEqual(moved([1, 2, 3, 4], 0, 3), [2, 3, 4, 1]) // move to bottom
// Round 4: "Visa card", Tab, type "Lia", Enter saved the card under the old class "Bank". The guard blocks that Enter.
const kinds = [{ value: "bank", label: "Bank" }, { value: "liability", label: "Liabilities" }]
assert.deepStrictEqual(staleSearch("Lia", "bank", kinds), true)
assert.deepStrictEqual(staleSearch("zzz", "bank", kinds), true)
assert.deepStrictEqual(staleSearch("", "bank", kinds), true)
assert.deepStrictEqual(staleSearch("Bank", "bank", kinds), false)
assert.deepStrictEqual(staleSearch("Liabilities", "liability", kinds), false)
