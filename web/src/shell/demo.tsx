/* oxlint-disable react/only-export-components -- the demo's load, clear and banner belong together */
import { useState } from "react"
import { Alert, Button, Group, Text } from "@mantine/core"
import { notifications } from "@mantine/notifications"
import { Eraser, FlaskConical } from "lucide-react"
import * as api from "../api/client"
import { useLedgerState } from "../api/useLedger"
import type { Settings } from "../api/types"
import { t } from "../i18n"
import { todayISO } from "../lib/format"
import { askConfirm } from "./confirm"

type DemoIds = { accounts: number[]; loans: number[]; events: number[] }
const parse = (s: Settings): DemoIds | null => {
  try {
    return s.demo ? { accounts: [], loans: [], events: [], ...JSON.parse(s.demo) } : null
  } catch {
    return null
  }
}

const remove = async ({ accounts, loans, events }: DemoIds) => {
  for (const id of loans) await api.deleteLoan(id).catch(() => {}) // already deleted by hand: fine
  for (const id of events) await api.deleteEvent(id).catch(() => {})
  for (const id of accounts) await api.deleteAccount(id).catch(() => {})
}

/**
 * Writes the sample household into the (empty) ledger and remembers every id it made in settings.demo, so
 * "clear demo data" can take exactly those out again. Plain API calls and one refresh at the end. A failure
 * part way removes what was written, so the first-run screen comes back instead of a half-built ledger.
 */
export async function loadDemo(en: boolean) {
  const today = todayISO()
  const end = today.slice(8) >= "15" ? today : new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 2, 15)).toISOString().slice(0, 10)
  const { demoLedger } = await import("../lib/demo") // only the first-run card needs the sample data
  const d = demoLedger(end, en)
  const ids: DemoIds = { accounts: [], loans: [], events: [] }
  try {
    for (const a of d.accounts) ids.accounts.push((await api.createAccount(a)).id)
    const snaps = d.balances.map(({ account, ...b }) => ({ account_id: ids.accounts[account], ...b }))
    for (let i = 0; i < snaps.length; i += 200) await api.putSnapshots(snaps.slice(i, i + 200))
    for (const e of d.events) ids.events.push((await api.saveEvent(e)).id)
    for (const { account, ...l } of d.loans) ids.loans.push((await api.saveLoan({ ...l, account_id: ids.accounts[account] })).id)
    await api.putSettings({ title: d.title, demo: JSON.stringify(ids) })
  } catch (e) {
    await remove(ids)
    throw e
  }
}

/** Dashboard banner while the demo is loaded; the same action lives in Settings (DemoClearButton). */
export function DemoBanner() {
  const { state } = useLedgerState()
  if (!parse(state.settings)) return null
  return (
    <Alert mt="md" variant="light" color="gold" icon={<FlaskConical size={18} />} title={t("這是範例帳本")}>
      <Group justify="space-between" gap="sm">
        <Text fz="sm">{t("看夠了就清掉範例資料,從自己的帳戶開始;基準幣別也會解鎖。")}</Text>
        <DemoClearButton />
      </Group>
    </Alert>
  )
}

export function DemoClearButton() {
  const { state, refresh } = useLedgerState()
  const [busy, setBusy] = useState(false)
  const ids = parse(state.settings)
  if (!ids) return null
  const clear = () =>
    askConfirm({
      title: t("清除範例資料?"),
      body: t("會刪掉範例的帳戶、餘額、貸款和大事;你自己新增的不受影響。"),
      confirm: t("清除範例"),
      danger: true,
      onConfirm: async () => {
        setBusy(true)
        try {
          await remove(ids)
          await api.putSettings({ demo: "", title: "我的帳本" })
        } catch (e) {
          notifications.show({ color: "down", title: t("操作失敗"), message: (e as Error).message })
        } finally {
          await refresh()
          setBusy(false)
        }
      },
    })
  return (
    <Button variant="default" size="xs" leftSection={<Eraser size={14} />} loading={busy} onClick={clear}>
      {t("清除範例資料,重新開始")}
    </Button>
  )
}
