import { useEffect, useState } from "react"
import { Alert, Anchor, Badge, Button, EmptyState, FileInput, Group, Skeleton, Stack, Table, Text } from "@mantine/core"
import { notifications } from "@mantine/notifications"
import { CircleAlert, CircleCheck, FileSpreadsheet, FileUp, Upload, UserPlus } from "lucide-react"
import { apiMessage, previewImport } from "../../api/client"
import { useLedgerState } from "../../api/useLedger"
import type { ImportPreview, Kind, NewAccount, UnknownAccount } from "../../api/types"
import { enOf, T, t, useLang } from "../../i18n"
import { CURRENCY_RE, fmtDate, fmtFx, fmtMoney, todayISO } from "../../lib/format"
import { SEEDED } from "../../lib/kinds"
import { askConfirm } from "../../shell/confirm"
import { CurrencyInput, KindSelect } from "../accounts/inputs"

const MAX_BYTES = 1 << 20 // server limit
const PREVIEW_ROWS = 5
const csvField = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s)

type Pick = { kind: string; currency: string; guessed?: boolean } // guessed: the CSV named a class that doesn't exist

/**
 * Defaults for an account the import creates: the CSV's kind cell matched by key, by name in either language,
 * or by a seeded class's original name (台股 / TW stocks still means tw_stock after FirstRun renamed it), else
 * the first asset class, flagged as a guess when the cell wasn't empty; its currency cell, else the base.
 */
function defaultPick(u: UnknownAccount, kinds: Kind[], base: string): Pick {
  const cell = u.kind.trim().toLowerCase()
  const names = (k: Kind) => [k.key, k.name, t(k.name), enOf(k.name), ...(SEEDED[k.key] ? [SEEDED[k.key], enOf(SEEDED[k.key])] : [])]
  const named = cell ? kinds.find((k) => names(k).some((n) => n.toLowerCase() === cell)) : undefined
  const kind = named ?? kinds.find((k) => k.liquidity !== "liability") ?? kinds[0]
  const cur = u.currency.trim().toUpperCase()
  return { kind: kind?.key ?? "", currency: CURRENCY_RE.test(cur) ? cur : base, guessed: !!cell && !named }
}

type Checked = { file: File; result?: ImportPreview; error?: string }

/**
 * Import balances from CSV. The server checks the file without writing (POST /api/import?dry_run=1), so the
 * preview says exactly what Import will do; names with no account yet get a class and currency picker and are
 * created on Import.
 */
export function CsvImport() {
  const { state, importCSV } = useLedgerState()
  const { lang } = useLang()
  const [file, setFile] = useState<File | null>(null)
  const [checked, setChecked] = useState<Checked | null>(null)
  const [picks, setPicks] = useState<Record<string, Pick>>({})
  const [all, setAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [imported, setImported] = useState<number | null>(null)
  const base = state.settings.base_currency
  const tooBig = !!file && file.size > MAX_BYTES

  const current = checked?.file === file ? checked : null
  const r = current?.result
  const rows = r?.rows ?? []
  const unknown = r?.unknown_accounts ?? []
  const errors = r?.errors ?? []
  const pickOf = (u: UnknownAccount) => picks[u.name] ?? defaultPick(u, state.kinds, base)
  // The accounts Import would create; the preview is checked with them too (a picked base currency vs a stray
  // fx column, rates to look up), so "ready" means the import will go through.
  const create: NewAccount[] = unknown.map((u) => ({ name: u.name, kind: pickOf(u).kind, currency: pickOf(u).currency }))
  const createKey = JSON.stringify(create.filter((a) => a.kind && CURRENCY_RE.test(a.currency)))

  // Runs again when the accounts or the picks change; the first answer lists the new names, the second checks the picks.
  useEffect(() => {
    if (!file || file.size > MAX_BYTES) return
    let live = true
    previewImport(file, JSON.parse(createKey)).then(
      (result) => live && setChecked({ file, result }),
      (e: Error) => live && setChecked({ file, error: e.message }),
    )
    return () => {
      live = false
    }
  }, [file, state.accounts, createKey])

  const overwrites = rows.filter((x) => x.overwrites).length
  const ready = !!r && !errors.length && rows.length > 0 && create.every((a) => !!a.kind && CURRENCY_RE.test(a.currency))
  const full = (v: number) => fmtMoney(v, "full", lang) // every digit, so the preview confirms what was parsed

  const pick = (f: File | null) => {
    setImported(null)
    setPicks({})
    setAll(false)
    setFile(f)
  }

  const run = async () => {
    if (!file) return
    setBusy(true)
    try {
      const res = await importCSV(file, create)
      setImported(res.imported)
      setFile(null)
      notifications.show({ color: "up", icon: <CircleCheck size={16} />, message: T`已匯入 ${res.imported} 筆餘額` })
    } catch {
      /* useLedger already showed the server's message; the preview reruns, so it shows what is left to fix */
    } finally {
      setBusy(false)
    }
  }

  const submit = () =>
    overwrites
      ? askConfirm({
          title: t("覆蓋既有餘額?"),
          body: T`有 ${overwrites} 筆的帳戶在同一天已經有餘額,匯入後會被 CSV 的數字取代。`,
          confirm: t("匯入並覆蓋"),
          danger: true,
          onConfirm: () => void run(),
        })
      : void run()

  const sample = state.accounts.find((a) => !a.archived)?.name ?? t("帳戶名稱")
  const template = "data:text/csv;charset=utf-8," + encodeURIComponent(`﻿date,account,amount,fx,kind,currency\n${todayISO()},${csvField(sample)},100000,,,\n`)

  return (
    <Stack gap="sm">
      <FileInput
        label={t("匯入餘額 CSV")}
        description={
          <>
            {t("欄位:date,account,amount,fx(fx 可省略,會自動查當天匯率)。還沒有的帳戶會在匯入時建立,可以多加 kind、currency 兩欄當它們的預設類別和幣別。")}{" "}
            <Anchor href={template} download="wealth-import.csv" fz="inherit">
              {t("下載範本")}
            </Anchor>
          </>
        }
        placeholder={t("選擇 .csv 檔")}
        accept=".csv,text/csv"
        clearable
        clearButtonProps={{ "aria-label": t("清除") }}
        value={file}
        onChange={pick}
        leftSection={<FileUp size={16} aria-hidden />}
      />

      {imported != null && (
        <Alert color="up" icon={<CircleCheck size={18} />} withCloseButton onClose={() => setImported(null)} closeButtonLabel={t("關閉")}>
          {T`已匯入 ${imported} 筆餘額`}
        </Alert>
      )}

      {!file && imported == null && (
        <EmptyState size="sm" variant="light" icon={<FileSpreadsheet size={20} />} description={t("選好檔案後會先預覽,確認沒問題再匯入。")} />
      )}

      {file && !tooBig && !current && <Skeleton h={140} radius="md" />}

      {(tooBig || current?.error) && (
        <Alert color="down" icon={<CircleAlert size={18} />}>
          {tooBig ? t("檔案讀取失敗或超過 1 MB") : current?.error}
        </Alert>
      )}

      {errors.map((e) => (
        <Alert key={e.error} color="down" icon={<CircleAlert size={18} />}>
          {apiMessage(e)}
        </Alert>
      ))}

      {rows.length > 0 && (
        <>
          <Group gap="xs">
            <Badge variant="light">{T`共 ${rows.length} 筆`}</Badge>
            {overwrites > 0 && (
              <Badge variant="light" color="warn">
                {T`覆蓋 ${overwrites} 筆`}
              </Badge>
            )}
            {r!.fx_lookups > 0 && (
              <Text fz="xs" c="dimmed">
                {T`匯入時會查 ${r!.fx_lookups} 組匯率`}
              </Text>
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
                {(all ? rows : rows.slice(0, PREVIEW_ROWS)).map((x) => {
                  const cur = x.currency
                  return (
                    <Table.Tr key={x.line}>
                      <Table.Td className="num">{fmtDate(x.date)}</Table.Td>
                      <Table.Td>
                        {x.account}
                        {x.overwrites && (
                          <Badge ml={6} size="xs" variant="light" color="warn">
                            {t("覆蓋")}
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td ta="right" className="num" style={{ whiteSpace: "nowrap" }}>
                        {full(x.amount)} <Text span c="dimmed" fz="xs">{cur}</Text>
                      </Table.Td>
                      <Table.Td ta="right" className="num">
                        {x.fx ? fmtFx(x.fx) : cur === base ? "1" : t("自動")}
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {rows.length > PREVIEW_ROWS && (
            <Button variant="subtle" size="compact-sm" w="fit-content" onClick={() => setAll(!all)}>
              {all ? T`只顯示前 ${PREVIEW_ROWS} 筆` : T`顯示全部 ${rows.length} 筆`}
            </Button>
          )}
        </>
      )}

      {unknown.length > 0 && (
        <Alert color="warn" icon={<UserPlus size={18} />} title={T`新增 ${unknown.length} 個帳戶`}>
          <Text fz="xs" mb="sm">
            {t("CSV 裡這些名稱還沒有帳戶,匯入時會先建立。請確認類別和幣別:")}
          </Text>
          <Stack gap="xs">
            {unknown.map((u, i) => {
              const p = pickOf(u)
              const set = (patch: Partial<Pick>) => setPicks((m) => ({ ...m, [u.name]: { ...p, ...patch } }))
              const kindName = t(state.kinds.find((k) => k.key === p.kind)?.name ?? "")
              return (
                <Group key={u.name} gap="xs" wrap="wrap" align="center">
                  <Stack gap={0} style={{ flex: "1 1 80px", minWidth: 0 }}>
                    <Text fz="sm" fw={500} style={{ overflowWrap: "anywhere" }}>
                      {u.name}
                    </Text>
                    {p.guessed && (
                      <Text fz="xs" c="warn" id={`guess-${i}`}>
                        {T`沒有「${u.kind}」這個類別,先用「${kindName}」`}
                      </Text>
                    )}
                  </Stack>
                  {/* the two pickers stay side by side; on a narrow screen they wrap under the name together */}
                  <Group gap="xs" wrap="nowrap">
                    <KindSelect
                      size="xs"
                      w={150}
                      aria-label={T`${u.name} 的類別`}
                      aria-describedby={p.guessed ? `guess-${i}` : undefined}
                      value={p.kind}
                      onChange={(v) => v && set({ kind: v, guessed: false })}
                    />
                    <CurrencyInput
                      size="xs"
                      w={80}
                      aria-label={T`${u.name} 的幣別`}
                      value={p.currency}
                      onChange={(v) => set({ currency: v })}
                      error={CURRENCY_RE.test(p.currency) ? undefined : true}
                    />
                  </Group>
                </Group>
              )
            })}
          </Stack>
        </Alert>
      )}

      {rows.length > 0 && (
        <Group justify="flex-end">
          <Button leftSection={<Upload size={16} />} disabled={!ready} loading={busy} onClick={submit}>
            {unknown.length ? T`新增 ${unknown.length} 個帳戶並匯入 ${rows.length} 筆` : T`匯入 ${rows.length} 筆`}
          </Button>
        </Group>
      )}
    </Stack>
  )
}
