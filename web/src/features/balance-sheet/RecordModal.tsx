import { useEffect, useRef, useState, type FormEvent } from "react"
import { Box, Button, Group, Modal, Stack, Text } from "@mantine/core"
import { DateInput } from "@mantine/dates"
import { useHotkeys } from "@mantine/hooks"
import { useIsPhone } from "../../shell/useIsPhone"
import { ArrowRight, CalendarDays, Check } from "lucide-react"
import { getFx } from "../../api/client"
import { useLedgerState, useMoney } from "../../api/useLedger"
import { T, t } from "../../i18n"
import { fmtDate, fmtInput, parseDay, todayISO } from "../../lib/format"
import { askConfirm } from "../../shell/confirm"
import { DirtyContext, useDirty, useGuardedClose } from "../../shell/dirty"
import { notifyUndo } from "../../shell/undo"
import { RecordRow } from "./RecordRow"
import type { Account } from "../../api/types"
import { asOf, isLiability, isStale, parseDraft, prefill, type Draft } from "./sheet"

type Props = { opened: boolean; onClose: () => void }

/** 記一筆: one balance per active account for a date. Only rows the user changed are saved. */
export function RecordModal({ opened, onClose }: Props) {
  const fullScreen = useIsPhone()
  // a fresh form (prefilled from the latest state) every time the dialog opens
  const [session, setSession] = useState(0)
  const [wasOpen, setWasOpen] = useState(opened)
  if (opened !== wasOpen) {
    setWasOpen(opened)
    if (opened) setSession((s) => s + 1)
  }
  // Typed balances are never thrown away silently: every close path (Cancel, Esc, X, backdrop) asks first.
  const [unsaved, setUnsaved] = useState(0)
  const { dirty, close: requestClose } = useGuardedClose(onClose, {
    title: T`放棄 ${unsaved} 筆未儲存的餘額?`,
    body: t("關掉後這次填的數字都不會保留。"),
    cancel: t("繼續填"),
  })
  return (
    <Modal opened={opened} onClose={requestClose} title={t("記一筆")} size="xl" fullScreen={fullScreen}>
      <DirtyContext.Provider value={dirty}>
        <RecordForm key={session} onClose={onClose} onCancel={requestClose} onUnsaved={setUnsaved} focusFirst={!fullScreen} />
      </DirtyContext.Provider>
    </Modal>
  )
}

type FormProps = { onClose: () => void; onCancel: () => void; onUnsaved: (n: number) => void; focusFirst: boolean }

function RecordForm({ onClose, onCancel, onUnsaved, focusFirst }: FormProps) {
  const { state, saveSnapshots, deleteSnapshot } = useLedgerState()
  const money = useMoney()
  const base = state.settings.base_currency
  const today = todayISO()
  const [active] = useState(() => state.accounts.filter((a) => !a.archived))
  const [date, setDate] = useState(today)
  const [drafts, setDrafts] = useState<Record<number, Draft>>(() => Object.fromEntries(active.map((a) => [a.id, prefill(a, today)])))
  const [fxLoading, setFxLoading] = useState<string[]>([])
  const [fxFailed, setFxFailed] = useState<string[]>([])
  const [dayRates, setDayRates] = useState<Record<string, string>>({}) // the chosen day's rate per currency
  const [saving, setSaving] = useState(false)
  const [dateOpen, setDateOpen] = useState(false)
  const dateRef = useRef(date)
  const amountInputs = useRef<(HTMLInputElement | null)[]>([])
  const fxInputs = useRef<(HTMLInputElement | null)[]>([])

  // Fetch each foreign currency's rate for the chosen day. A row takes it only once you type its balance
  // (and not its rate), and only if it has no record that day: untouched rows keep showing, and saving,
  // the rate their carried balance was recorded at, which is what the series uses for them. On failure the
  // earlier rate stays, still editable.
  const loadFx = (d: string) => {
    dateRef.current = d
    const curs = [...new Set(active.filter((a) => !asOf(a, d).exact).map((a) => a.currency).filter((c) => c !== base))]
    setFxLoading(curs)
    setFxFailed([])
    setDayRates({})
    for (const cur of curs)
      getFx(cur, d)
        // full precision: rounding a weak currency's rate (IDR→USD 0.0000559) skews the value
        .then((rate) => dateRef.current === d && setDayRates((r) => ({ ...r, [cur]: String(rate) })))
        .catch(() => dateRef.current === d && setFxFailed((f) => [...f, cur]))
        .finally(() => dateRef.current === d && setFxLoading((l) => l.filter((c) => c !== cur)))
  }
  /** What a row shows and saves: its draft, with the day's rate once its balance was typed. */
  const view = (a: Account): Draft => {
    const d = drafts[a.id]
    const rate = dayRates[a.currency]
    return d.touched && !d.fxTyped && rate && !asOf(a, date).exact ? { ...d, fx: rate } : d
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
          return [a.id, p.fxTyped ? p : { ...p, fx: prefill(a, d).fx }]
        }),
      ),
    )
    loadFx(d)
  }

  const rows = active.map((a) => ({ a, parsed: parseDraft(a, view(a), base, isLiability(a, state.kinds), date) }))
  const changed = rows.filter((r) => r.parsed.kind === "ok" && r.parsed.dirty)
  const firstError = rows.findIndex((r) => r.parsed.kind === "error")
  // Net worth on the chosen day (the series carries every account forward), so a backdated record previews correctly.
  const before = state.series.findLast((r) => r.date <= date)?.total ?? 0
  const after = before + rows.reduce((s, r) => s + (r.parsed.kind === "ok" ? r.parsed.delta : 0), 0)
  const diff = after - before
  const touched = active.filter((a) => drafts[a.id].touched).length
  useEffect(() => onUnsaved(touched), [touched, onUnsaved])
  useDirty(touched > 0)
  // A typed row whose rate is still on its way would otherwise save with the old (or no) rate.
  const waitingFx = active.some((a) => drafts[a.id].touched && fxLoading.includes(a.currency))

  const patch = (id: number, p: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...p, touched: true, ...(p.fx !== undefined && { fxTyped: true }) } }))

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

  // Set when a save starts and cleared only if it fails: a second Enter (the input keeps focus while the dialog
  // plays its close transition) or a second confirm click must not post the batch again.
  const submitted = useRef(false)
  const overwriteAsked = useRef(false)
  const save = async () => {
    if (submitted.current) return
    submitted.current = true
    setSaving(true)
    // Undo puts back what each saved row replaced: the earlier record that day, or no record at all
    // (a batch saved under the wrong date comes back out in one click).
    const replaced = changed.map(({ a }) => ({ a, point: asOf(a, date).exact ? asOf(a, date).point : undefined }))
    const undo = async () => {
      const back = replaced.flatMap(({ a, point }) => (point ? [{ account_id: a.id, date, amount: point.amount, fx: point.fx }] : []))
      if (back.length) await saveSnapshots(back)
      for (const { a, point } of replaced) if (!point) await deleteSnapshot(a.id, date)
    }
    try {
      await saveSnapshots(
        changed.map(({ a, parsed: p }) => ({ account_id: a.id, date, amount: p.kind === "ok" ? p.amount : 0, fx: p.kind === "ok" ? p.fx : 1 })),
      )
      notifyUndo({
        title: T`已記錄 ${fmtDate(date)}`,
        message: T`${changed.length} 個帳戶 · 淨資產 ${money(after)}(${money(diff, { signed: true })})`,
        undo,
      })
      ;(document.activeElement as HTMLElement | null)?.blur()
      onClose()
    } catch {
      submitted.current = false /* useLedger already showed the error; keep the form */
    } finally {
      setSaving(false)
    }
  }

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (waitingFx || saving || submitted.current) return
    if (firstError >= 0) {
      const p = rows[firstError].parsed
      return (p.kind === "error" && p.field === "fx" ? fxInputs : amountInputs).current[firstError]?.focus()
    }
    if (!changed.length || !date) return
    const replaced = changed.filter((r) => r.parsed.kind === "ok" && r.parsed.overwrites).map((r) => r.a.name)
    if (!replaced.length) return void save()
    if (overwriteAsked.current) return // a second Enter before focus moved into the confirm: one prompt only
    overwriteAsked.current = true
    askConfirm({
      title: T`覆蓋 ${fmtDate(date)} 的紀錄?`,
      body: T`這些帳戶在 ${fmtDate(date)} 已經有餘額,會改成這次填的數字:${replaced}`,
      confirm: t("覆蓋"),
      danger: true,
      onConfirm: () => void save(),
      onClose: () => (overwriteAsked.current = false),
    })
  }

  // mod+Enter saves from any field, the date and rate fields included (no tags ignored)
  useHotkeys([["mod+Enter", () => submit()]], [])

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
            placeholder={t("YYYY.MM.DD")}
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
              draft={view(a)}
              parsed={parsed}
              fxLoading={fxLoading.includes(a.currency)}
              initialFocus={focusFirst && i === 0}
              stale={isStale(a, today)}
              amountRef={(el) => {
                amountInputs.current[i] = el
              }}
              fxRef={(el) => {
                fxInputs.current[i] = el
              }}
              onChange={(p) => patch(a.id, p)}
              onPasteMany={(values) => pasteMany(i, values)}
              onAmountBlur={() => parsed.kind === "ok" && drafts[a.id].touched && setDrafts((prev) => ({ ...prev, [a.id]: { ...prev[a.id], amt: fmtInput(parsed.amount) } }))}
              onEnter={(from) => {
                // a foreign account's first record has no rate to carry forward: stop on the rate field before moving on
                const fx = fxInputs.current[i]
                if (from === "amt" && fx && a.currency !== base && (a.history.length === 0 || fxFailed.includes(a.currency))) {
                  fx.focus()
                  return
                }
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
                <ArrowRight size={14} role="img" aria-label={t("變成")} />
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
