// Self-check, not bundled: `node src/features/accounts/logic.check.ts` (Node ≥ 23 strips the types).
import { KEY_RE, moved, slugKey } from "./logic.ts"

const eq = (got: unknown, want: unknown) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}
eq(slugKey("Gold ETF", []), "gold_etf")
eq(slugKey("Épargne 2", []), "epargne_2")
eq(slugKey("保險", []), "kind")
eq(slugKey("保險", ["kind", "kind_2"]), "kind_3")
eq(slugKey("退休金", ["invest"], "invest"), "invest_2")
eq(slugKey("401k plan", []), "k_plan")
eq(slugKey("bank", ["bank"]), "bank_2")
for (const name of ["Gold ETF", "保險", "x", "a".repeat(80), "9_9", "__A__"]) eq(KEY_RE.test(slugKey(name, [])), true)
eq(KEY_RE.test(slugKey("a".repeat(40), ["a".repeat(28)])), true)
eq(moved([1, 2, 3], 0, 1), [2, 1, 3])
eq(moved([1, 2, 3], 2, 1), [1, 2, 3])
eq(moved([1, 2, 3], 0, -1), [1, 2, 3])
console.log("accounts logic ok")
