import { useMemo, useState } from "react"
import { Alert, Anchor, Badge, Button, EmptyState, FileInput, Group, Skeleton, Stack, Table, Text } from "@mantine/core"
import { modals } from "@mantine/modals"
import { notifications } from "@mantine/notifications"
import { CircleAlert, CircleCheck, FileSpreadsheet, FileUp, Upload } from "lucide-react"
import { useLedgerState, useMoney } from "../../api/useLedger"
import type { Account } from "../../api/types"
import { T, t, tKey } from "../../i18n"
import { fmtDate, todayISO } from "../../lib/format"
import { csvField, parseImport } from "./csv"

const MAX_BYTES = 1 << 20 // server limit
const PREVIEW_ROWS = 5
const list = (xs: (string | number)[], max = 5) => xs.slice(0, max).join(t("、")) + (xs.length > max ? "…" : "")

type Picked = { file: File; text: string | null; error?: string }

export function CsvImport() {
  const { state, importCSV } = useLedgerState()
  const money = useMoney()
  const [picked, setPicked] = useState<Picked | null>(null)
  const [busy, setBusy] = useState(false)
  const [imported, setImported] = useState<number | null>(null)

  // Same rules as the server: names match exactly, and a name two accounts share is refused (ambiguous).
  const { byName, shared } = useMemo(() => {
    const m = new Map<string, Account>()
    const dup = new Set<string>()
    for (const a of state.accounts) {
      if (m.has(a.name)) dup.add(a.name)
      else m.set(a.name, a)
    }
    return { byName: m, shared: dup }
  }, [state.accounts])
  const base = state.settings.base_currency

  const parsed = useMemo(() => (picked?.text == null ? null : parseImport(picked.text)), [picked])
  const rows = parsed?.rows ?? []
  const unknown = [...new Set(rows.map((r) => r.account).filter((n) => n && !byName.has(n)))]
  const ambiguous = [...new Set(rows.map((r) => r.account).filter((n) => shared.has(n)))]
  const bad = rows.filter((r) => !r.ok).map((r) => r.line)
  const future = rows.filter((r) => r.future).map((r) => r.line)
  const baseFx = [...new Set(rows.filter((r) => r.fx !== null && r.fx !== 1 && byName.get(r.account)?.currency === base).map((r) => r.account))]
  const overwrites = rows.filter((r) => byName.get(r.account)?.history.some((p) => p.date === r.date)).length
  const ready = !!parsed && !parsed.error && !unknown.length && !ambiguous.length && !bad.length && !future.length && !baseFx.length

  const pick = (file: File | null) => {
    setImported(null)
    if (!file) return setPicked(null)
    if (file.size > MAX_BYTES) return setPicked({ file, text: null, error: t("檔案讀取失敗或超過 1 MB") })
    setPicked({ file, text: null })
    file.text().then(
      (text) => setPicked((p) => (p?.file === file ? { file, text } : p)),
      () => setPicked((p) => (p?.file === file ? { file, text: null, error: t("檔案讀取失敗或超過 1 MB") } : p)),
    )
  }

  const run = async () => {
    if (!picked?.text) return
    setBusy(true)
    try {
      const r = await importCSV(picked.text)
      setImported(r.imported)
      setPicked(null)
      notifications.show({ color: "green", message: T`已匯入 ${r.imported} 筆餘額` })
    } catch {
      /* useLedger already showed the server's message; keep the file so it can be fixed and retried */
    } finally {
      setBusy(false)
    }
  }

  const submit = () =>
    overwrites
      ? modals.openConfirmModal({
          title: t("覆蓋既有餘額?"),
          children: <Text fz="sm">{T`有 ${overwrites} 筆的帳戶在同一天已經有餘額,匯入後會被 CSV 的數字取代。`}</Text>,
          labels: { confirm: t("匯入並覆蓋"), cancel: t("取消") },
          confirmProps: { color: "red" },
          onConfirm: () => void run(),
        })
      : void run()

  const sample = state.accounts.find((a) => !a.archived)?.name ?? t("帳戶名稱")
  const template = "data:text/csv;charset=utf-8," + encodeURIComponent(`\uFEFFdate,account,amount,fx\n${todayISO()},${csvField(sample)},100000,\n`)

  return (
    <Stack gap="sm">
      <FileInput
        label={t("匯入餘額 CSV")}
        description={
          <>
            {t("欄位:date,account,amount,fx(fx 可省略,會自動查當天匯率)。帳戶名稱要完全相同。")}{" "}
            <Anchor href={template} download="wealth-import.csv" fz="inherit">
              {t("下載範本")}
            </Anchor>
          </>
        }
        placeholder={t("選擇 .csv 檔")}
        accept=".csv,text/csv"
        clearable
        clearButtonProps={{ "aria-label": t("清除") }}
        value={picked?.file ?? null}
        onChange={pick}
        leftSection={<FileUp size={16} aria-hidden />}
      />

      {imported != null && (
        <Alert color="green" icon={<CircleCheck size={18} />} withCloseButton onClose={() => setImported(null)} closeButtonLabel={t("關閉")}>
          {T`已匯入 ${imported} 筆餘額`}
        </Alert>
      )}

      {!picked && imported == null && (
        <EmptyState size="sm" variant="light" icon={<FileSpreadsheet size={20} />} description={t("選好檔案後會先預覽,確認沒問題再匯入。")} />
      )}

      {picked && !picked.error && !parsed && <Skeleton h={140} radius="md" />}

      {(picked?.error || parsed?.error) && (
        <Alert color="red" icon={<CircleAlert size={18} />}>
          {picked?.error ?? tKey(parsed!.error!, parsed!.params ?? [])}
        </Alert>
      )}

      {parsed && !parsed.error && (
        <>
          <Group gap="xs">
            <Badge variant="light">{T`共 ${rows.length} 筆`}</Badge>
            {overwrites > 0 && (
              <Badge variant="light" color="orange">
                {T`覆蓋 ${overwrites} 筆`}
              </Badge>
            )}
          </Group>
          <Table.ScrollContainer minWidth={340}>
            <Table fz="xs" striped verticalSpacing={4} aria-label={t("匯入預覽")}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("日期")}</Table.Th>
                  <Table.Th>{t("帳戶")}</Table.Th>
                  <Table.Th ta="right">{t("金額")}</Table.Th>
                  <Table.Th ta="right">{t("匯率")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.slice(0, PREVIEW_ROWS).map((r) => {
                  const a = byName.get(r.account)
                  return (
                    <Table.Tr key={r.line} c={r.ok && !r.future && a ? undefined : "var(--wealth-down)"}>
                      <Table.Td className="num">{fmtDate(r.date) || "—"}</Table.Td>
                      <Table.Td>{r.account || "—"}</Table.Td>
                      <Table.Td ta="right" className="num">
                        {Number.isFinite(r.amount) ? money(r.amount) : "—"} {a && <Text span c="dimmed" fz="xs">{a.currency}</Text>}
                      </Table.Td>
                      <Table.Td ta="right" className="num">
                        {r.fx ?? (a && a.currency !== base ? t("自動") : "1")}
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {rows.length > PREVIEW_ROWS && (
            <Text c="dimmed" fz="xs">
              {T`只顯示前 ${PREVIEW_ROWS} 筆。`}
            </Text>
          )}
          {unknown.length > 0 && (
            <Alert color="orange" icon={<CircleAlert size={18} />} title={t("找不到這些帳戶")}>
              <Text fz="sm">{list(unknown, 10)}</Text>
              <Text fz="xs" c="dimmed" mt={4}>
                {t("先在「帳戶與類別」新增,或把 CSV 裡的名稱改成跟現有帳戶一樣。")}
              </Text>
            </Alert>
          )}
          {ambiguous.length > 0 && (
            <Alert color="red" icon={<CircleAlert size={18} />}>
              {tKey("有好幾個帳戶叫這些名字,請先改成不同的名字:{}", [ambiguous])}
            </Alert>
          )}
          {future.length > 0 && (
            <Alert color="red" icon={<CircleAlert size={18} />}>
              {tKey("第 {} 列的日期在未來", [list(future)])}
            </Alert>
          )}
          {baseFx.length > 0 && (
            <Alert color="red" icon={<CircleAlert size={18} />}>
              {tKey("這些帳戶是基準幣別,fx 要留空或填 1:{}", [baseFx])}
            </Alert>
          )}
          {bad.length > 0 && (
            <Alert color="red" icon={<CircleAlert size={18} />}>
              {T`第 ${list(bad)} 列的日期(YYYY-MM-DD)、金額或匯率不正確。`}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button leftSection={<Upload size={16} />} disabled={!ready} loading={busy} onClick={submit}>
              {T`匯入 ${rows.length} 筆`}
            </Button>
          </Group>
        </>
      )}
    </Stack>
  )
}
