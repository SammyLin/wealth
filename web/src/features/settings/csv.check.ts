// Self-check, not bundled: `node src/features/settings/csv.check.ts` (Node ≥ 23 strips the types).
import { csvField, parseImport, splitCSV } from "./csv.ts"

const eq = (got: unknown, want: unknown) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}
eq(splitCSV('a,"b,""c"""\r\n\r\n1,2'), [["a", 'b,"c"'], ["1", "2"]])
eq(splitCSV("a,b\n"), [["a", "b"]])

const p = parseImport('\uFEFFAccount,Date,Amount\n"台新, 活存",2026-10-01,"1,234,567"\nX,2026-13-01,5\nY,2026-10-01,\n')
eq(p.error, undefined)
eq(p.rows[0], { line: 2, date: "2026-10-01", account: "台新, 活存", amount: 1234567, fx: null, ok: true, future: false })
eq([p.rows[1].ok, p.rows[2].ok], [false, false])

eq(parseImport("date,account,amount,fx\n2026-10-01,A,10,0").rows[0].ok, false)
eq(parseImport("date,account,amount,fx\n2026-10-01,A,10,31.5").rows[0].fx, 31.5)
eq(parseImport("date,amount\n2026-10-01,1").error, "第一列要是標題:date,account,amount,fx(fx 可省略)")
eq(parseImport("date,account,amount\n").error, "CSV 沒有資料列")
eq(parseImport("").error, "CSV 是空的或格式錯誤")
eq(parseImport("date,account,amount\n2026-10-01,A,12.5萬").rows[0].amount, 125000)
eq(parseImport("date,account,amount\n2026-10-01,'=A,1").rows[0].account, "=A")
eq(parseImport('date,account,amount\n2026-10-01,A,"1.234,56"').rows[0].ok, false)
eq(parseImport("date;account;amount\n2026-10-01;A;1").error, "這個檔案用分號分隔,請改成逗號分隔的 CSV")
eq(csvField('a"b'), '"a""b"')
eq(csvField("plain"), "plain")
eq(parseImport("date,account,amount\n2026-02-31,A,1").rows[0].ok, false) // not a real day (Go rejects it too)
eq(parseImport("date,account,amount\n0001-01-01,A,1").rows[0].ok, false)
eq(parseImport("date,account,amount\n2026-10-05,A,1\n2062-09-30,A,1", "2026-10-04").rows.map((r) => r.future), [false, true])
eq(parseImport('date,account,amount\n2026-10-01,A"B,1'), { rows: [], error: "第 {} 列格式錯誤", params: [2] }) // bare quote mid-field
eq(parseImport('date,account,amount\n2026-10-01,"A"B,1').error, "第 {} 列格式錯誤")
eq(parseImport("date,account,amount\n2026-10-01,''=x,1").rows[0].account, "'=x")
console.log("csv ok")
