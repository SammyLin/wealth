import { useEffect, useRef, useState, type FormEvent } from "react"
import { Box, Button, Group, Modal, Stack, Text } from "@mantine/core"
import { DateInput } from "@mantine/dates"
import { useMediaQuery } from "@mantine/hooks"
import { modals } from "@mantine/modals"
import { notifications } from "@mantine/notifications"
import { ArrowRight, CalendarDays, Check } from "lucide-react"
import { getFx } from "../../api/client"
import { useLedgerState, useMoney } from "../../api/useLedger"
import { T, t, useLang } from "../../i18n"
import { fmtDate, todayISO } from "../../lib/format"
import { RecordRow } from "./RecordRow"
import { asOf, fmtInput, isLiability, parseDraft, prefill, type Draft } from "./sheet"

type Props = { opened: boolean; onClose: () => void }

/** 記一筆: one balance per active account for a date. Only rows the user changed are saved. */
export function RecordModal({ opened, onClose }: Props) {
  const fullScreen = useMediaQuery("(max-width: 48em)")
  // a fresh form (prefilled from the latest state) every time the dialog opens
  const [session, setSession] = useState(0)
  const [wasOpen, setWasOpen] = useState(opened)
  if (opened !== wasOpen) {
    setWasOpen(opened)
    if (opened) setSession((s) => s + 1)
  }
  // Typed balances are never thrown away silently: every close path (Cancel, Esc, X, backdrop) asks first.
  // Both this dialog and the confirm listen for Esc on window, so while the confirm is up (and until the
  // event that closed it has finished) further close requests are ignored instead of opening a second one.
  const [unsaved, setUnsaved] = useState(0)
  const confirming = useRef(false)
  const requestClose = () => {
    if (confirming.current) return
    if (!unsaved) return onClose()
    confirming.current = true
    modals.openConfirmModal({
      title: T`放棄 ${unsaved} 筆未儲存的餘額?`,
      children: <Text fz="sm">{t("關掉後這次填的數字都不會保留。")}</Text>,
      labels: { confirm: t("放棄"), cancel: t("繼續填") },
      confirmProps: { color: "red" },
      onConfirm: onClose,
      onClose: () => setTimeout(() => (confirming.current = false)),
    })
  }
  return (
    <Modal opened={opened} onClose={requestClose} title={t("記一筆")} size="xl" fullScreen={fullScreen}>
      <RecordForm key={session} onClose={onClose} onCancel={requestClose} onUnsaved={setUnsaved} focusFirst={!fullScreen} />
    </Modal>
  )
}

/** Accepts 2026-10-03, 2026.10.03, 2026/10/3 and (English UI) "Oct 3, 2026" typed into the date field. */
function parseDay(v: string): string | null {
  const m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(v.trim())
  if (m) {
    const iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`
    return Number.isNaN(Date.parse(iso)) ? null : iso
  }
  const d = new Date(v) // "Oct 3, 2026": parsed as local midnight
  return /[a-z]/i.test(v) && !Number.isNaN(d.getTime()) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : null
}

type FormProps = { onClose: () => void; onCancel: () => void; onUnsaved: (n: number) => void; focusFirst: boolean }

function RecordForm({ onClose, onCancel, onUnsaved, focusFirst }: FormProps) {
  const { lang } = useLang()
  const { state, saveSnapshots } = useLedgerState()
  const money = useMoney()
  const base = state.settings.base_currency
  const today = todayISO()
  const [active] = useState(() => state.accounts.filter((a) => !a.archived))
  const [date, setDate] = useState(today)
  const [drafts, setDrafts] = useState<Record<number, Draft>>(() => Object.fromEntries(active.map((a) => [a.id, prefill(a, today)])))
  const [fxLoading, setFxLoading] = useState<string[]>([])
  const [fxFailed, setFxFailed] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [dateOpen, setDateOpen] = useState(false)
  const fxEdited = useRef(new Set<number>()) // rows whose rate the user typed; prefill leaves them alone
  const dateRef = useRef(date)
  const amountInputs = useRef<(HTMLInputElement | null)[]>([])
  const fxInputs = useRef<(HTMLInputElement | null)[]>([])

  // Prefill each foreign currency with the chosen day's rate, except rows that already have a record that
  // day (they keep its rate). On failure the earlier rate stays, still editable. Prefilled rates never count
  // as a change by themselves (see parseDraft).
  const loadFx = (d: string) => {
    dateRef.current = d
    const curs = [...new Set(active.filter((a) => !asOf(a, d).exact).map((a) => a.currency).filter((c) => c !== base))]
    setFxLoading(curs)
    setFxFailed([])
    for (const cur of curs)
      getFx(cur, d)
        .then((rate) => {
          if (dateRef.current !== d) return
          const fx = String(rate) // full precision: rounding a weak currency's rate (IDR→USD 0.0000559) skews the value
          setDrafts((prev) => {
            const next = { ...prev }
            for (const a of active)
              if (a.currency === cur && !fxEdited.current.has(a.id) && !asOf(a, d).exact) next[a.id] = { ...next[a.id], fx }
            return next
          })
        })
        .catch(() => dateRef.current === d && setFxFailed((f) => [...f, cur]))
        .finally(() => dateRef.current === d && setFxLoading((l) => l.filter((c) => c !== cur)))
  }
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- once per dialog session; date changes call loadFx directly
  useEffect(() => loadFx(date), [])

  // A new date re-prefills every row the user hasn't typed in from the balance as of that day.
  const changeDate = (d: string) => {
    setDate(d)
    setDrafts((prev) =>
      Object.fromEntries(
        active.map((a) => {
          const p = prev[a.id]
          if (!p.touched) return [a.id, prefill(a, d)]
          return [a.id, fxEdited.current.has(a.id) ? p : { ...p, fx: prefill(a, d).fx }]
        }),
      ),
    )
    loadFx(d)
  }

  const rows = active.map((a) => ({ a, parsed: parseDraft(a, drafts[a.id], base, isLiability(a, state.kinds), date) }))
  const changed = rows.filter((r) => r.parsed.kind === "ok" && r.parsed.dirty)
  const firstError = rows.findIndex((r) => r.parsed.kind === "error")
  // Net worth on the chosen day (the series carries every account forward), so a backdated record previews correctly.
  const before = state.series.findLast((r) => r.date <= date)?.total ?? 0
  const after = before + rows.reduce((s, r) => s + (r.parsed.kind === "ok" ? r.parsed.delta : 0), 0)
  const diff = after - before
  const touched = active.filter((a) => drafts[a.id].touched).length
  useEffect(() => onUnsaved(touched), [touched, onUnsaved])
  // A typed row whose rate is still on its way would otherwise save with the old (or no) rate.
  const waitingFx = active.some((a) => drafts[a.id].touched && fxLoading.includes(a.currency))

  const patch = (id: number, p: Partial<Draft>) => {
    if (p.fx !== undefined) fxEdited.current.add(id)
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...p, touched: true } }))
  }

  // A column pasted from a spreadsheet fills this row and the ones below it.
  const pasteMany = (from: number, values: string[]) =>
    setDrafts((prev) => {
      const next = { ...prev }
      values.forEach((v, k) => {
        const a = active[from + k]
        if (a && v) next[a.id] = { ...next[a.id], amt: v, touched: true } // a blank cell leaves its row alone
      })
      return next
    })

  const save = async () => {
    setSaving(true)
    try {
      await saveSnapshots(
        changed.map(({ a, parsed: p }) => ({ account_id: a.id, date, amount: p.kind === "ok" ? p.amount : 0, fx: p.kind === "ok" ? p.fx : 1 })),
      )
      notifications.show({
        icon: <Check size={16} />,
        title: T`已記錄 ${fmtDate(date)}`,
        message: T`${changed.length} 個帳戶 · 淨資產 ${money(after)}(${money(diff, { signed: true })})`,
      })
      onClose()
    } catch {
      /* useLedger already showed the error; keep the form */
    } finally {
      setSaving(false)
    }
  }

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (waitingFx) return
    if (firstError >= 0) {
      const p = rows[firstError].parsed
      return (p.kind === "error" && p.field === "fx" ? fxInputs : amountInputs).current[firstError]?.focus()
    }
    if (!changed.length || !date) return
    const replaced = changed.filter((r) => r.parsed.kind === "ok" && r.parsed.overwrites).map((r) => r.a.name)
    if (!replaced.length) return void save()
    modals.openConfirmModal({
      title: T`覆蓋 ${fmtDate(date)} 的紀錄?`,
      children: <Text fz="sm">{T`這些帳戶在 ${fmtDate(date)} 已經有餘額,會改成這次填的數字:${replaced}`}</Text>,
      labels: { confirm: t("覆蓋"), cancel: t("取消") },
      confirmProps: { color: "red" },
      onConfirm: () => void save(),
    })
  }

  return (
    <form onSubmit={submit} noValidate>
      <Stack gap="md">
        <Group align="flex-end" justify="space-between" gap="sm">
          <DateInput
            label={t("日期")}
            value={date}
            onChange={(v) => v && changeDate(v)}
            dateParser={parseDay}
            maxDate={today}
            placeholder={lang === "en" ? "Oct 3, 2026" : "YYYY.MM.DD"}
            // Esc with the calendar open closes only the calendar (Mantine's modal skips events from such targets)
            data-mantine-stop-propagation={dateOpen || undefined}
            popoverProps={{ onOpen: () => setDateOpen(true), onClose: () => setDateOpen(false) }}
            onKeyDown={(e) => {
              // Enter takes the typed date and moves on to the first balance (focus leaving closes the calendar and tidies the text)
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return
              e.preventDefault()
              amountInputs.current[0]?.focus()
            }}
            leftSection={<CalendarDays size={16} aria-hidden />}
            w={{ base: "100%", xs: 200 }}
          />
          <Text fz="xs" c="dimmed" maw={360}>
            {date < today
              ? T`補記 ${fmtDate(date)}:每列先帶入當天的餘額,只會存你改過的帳戶。`
              : t("改有變動的帳戶就好,其他會沿用上一筆。按 Enter 跳下一個,也可以貼上一整欄數字。")}
          </Text>
        </Group>

        <Box>
          {rows.map(({ a, parsed }, i) => (
            <RecordRow
              key={a.id}
              account={a}
              kind={state.kinds.find((k) => k.key === a.kind)}
              base={base}
              date={date}
              draft={drafts[a.id]}
              parsed={parsed}
              fxLoading={fxLoading.includes(a.currency)}
              initialFocus={focusFirst && i === 0}
              amountRef={(el) => {
                amountInputs.current[i] = el
              }}
              fxRef={(el) => {
                fxInputs.current[i] = el
              }}
              onChange={(p) => patch(a.id, p)}
              onPasteMany={(values) => pasteMany(i, values)}
              onAmountBlur={() => parsed.kind === "ok" && drafts[a.id].touched && setDrafts((prev) => ({ ...prev, [a.id]: { ...prev[a.id], amt: fmtInput(parsed.amount) } }))}
              onFxEnter={() => {
                const next = amountInputs.current[i + 1]
                if (next) next.focus()
                else submit()
              }}
              onEnter={() => {
                const next = amountInputs.current[i + 1]
                if (next) next.focus()
                else submit()
              }}
            />
          ))}
        </Box>
        {fxFailed.length > 0 && (
          <Text component="output" fz="xs" c="dimmed" display="block">
            {T`${fxFailed} 的匯率沒抓到:有舊紀錄的帳戶先沿用上一次的匯率,第一次記錄的請手動填匯率。`}
          </Text>
        )}

        <Box pos="sticky" bottom={0} py="sm" bg="var(--mantine-color-body)" style={{ borderTop: "1px solid var(--wealth-rule)", zIndex: 1 }}>
          <Group justify="space-between" gap="sm">
            <Box aria-live="polite" miw={0}>
              <Text fz="xs" c="dimmed">
                {date < today ? T`${fmtDate(date)} 的淨資產` : t("淨資產")}
              </Text>
              <Group gap={6} wrap="nowrap" className="num">
                <Text className="num" fz="sm" c="dimmed">
                  {money(before)}
                </Text>
                <ArrowRight size={14} aria-label={t("變成")} />
                <Text className="num" fz="lg" fw={500}>
                  {money(after)}
                </Text>
                {diff !== 0 && (
                  <Text className="num" fz="sm" c={diff > 0 ? "var(--wealth-up)" : "var(--wealth-down)"}>
                    {money(diff, { signed: true })}
                  </Text>
                )}
              </Group>
            </Box>
            <Group gap="xs" ml="auto">
              <Button variant="default" onClick={onCancel}>
                {t("取消")}
              </Button>
              <Button type="submit" loading={saving || waitingFx} disabled={!changed.length} leftSection={<Check size={16} />}>
                {changed.length ? T`儲存 ${changed.length} 筆` : t("沒有變動")}
              </Button>
            </Group>
          </Group>
        </Box>
      </Stack>
    </form>
  )
}
