import { useMemo, useState } from "react"
import { Button, Collapse, Group, SimpleGrid, Stack, Text, TextInput } from "@mantine/core"
import { MonthPickerInput } from "@mantine/dates"
import { Calculator, ChevronUp } from "lucide-react"
import type { LoanView } from "../../api/types"
import { useMoney } from "../../api/useLedger"
import { T, t } from "../../i18n"
import { fmtDate, fmtInput, parseAmount, todayISO } from "../../lib/format"
import { extraToFinishBy, simulate } from "./math"

/**
 * "What if I paid more?" on one loan (YNAB's Loan Planner, reduced to three inputs): extra per month, one lump
 * sum, or a month to be done by. Shows payoff date, total interest and, for a loan still in its grace period,
 * the payment it jumps to. Pure client-side math; nothing is saved.
 */
export function Simulator({ loan: l }: { loan: LoanView }) {
  const money = useMoney()
  const [open, setOpen] = useState(false)
  const [extraText, setExtraText] = useState("")
  const [lumpText, setLumpText] = useState("")
  const [lumpMonth, setLumpMonth] = useState<string | null>(null)
  const [finishBy, setFinishBy] = useState<string | null>(null)

  const r = useMemo(() => {
    const base = simulate(l)
    const typed = parseAmount(extraText)
    const needed = finishBy ? extraToFinishBy(l, finishBy.slice(0, 7)) : NaN
    // a "done by" month sets the monthly extra unless the user typed one
    const extra = typed > 0 ? typed : needed > 0 ? needed : 0
    const lumpAmount = parseAmount(lumpText)
    const lump = lumpAmount > 0 && lumpMonth ? { month: lumpMonth.slice(0, 7), amount: lumpAmount } : undefined
    const sim = simulate(l, { extra, lump })
    const paidExtra = extra * sim.months + (lump?.amount ?? 0)
    return { base, sim, extra, needed, lump, saved: base.interest - sim.interest, sooner: base.months - sim.months, perDollar: paidExtra > 0 ? (base.interest - sim.interest) / paidExtra : 0 }
  }, [l, extraText, lumpText, lumpMonth, finishBy])

  const changed = r.extra > 0 || r.lump
  // the level payment is only still open while the loan is interest-only; after that, extras shorten the term
  const inGrace = l.grace_months > 0 && todayISO() < l.grace_end
  const arrow = (from: string, to: string) => (changed ? `${from} → ${to}` : from)

  return (
    <Stack gap="xs" mt="sm">
      <Button variant="subtle" size="compact-sm" leftSection={open ? <ChevronUp size={14} /> : <Calculator size={14} />} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? t("收起試算") : t("試算提前還款")}
      </Button>
      <Collapse expanded={open}>
        <Stack gap="sm" p="sm" bg="var(--wealth-paper-2)" style={{ borderRadius: "var(--mantine-radius-sm)" }}>
          <SimpleGrid cols={{ base: 1, xs: 3 }} spacing="sm">
            <TextInput
              label={t("每月多還")}
              placeholder={t("1萬")}
              value={extraText}
              onChange={(e) => setExtraText(e.currentTarget.value)}
              onBlur={() => parseAmount(extraText) > 0 && setExtraText(fmtInput(parseAmount(extraText)))}
              inputMode="decimal"
              description={finishBy && !(parseAmount(extraText) > 0) && r.needed > 0 ? T`要在 ${fmtDate(finishBy.slice(0, 7))} 還清,每月多還 ${money(r.needed)}` : undefined}
            />
            <TextInput
              label={t("一次多還")}
              placeholder={t("100萬")}
              value={lumpText}
              onChange={(e) => setLumpText(e.currentTarget.value)}
              onBlur={() => parseAmount(lumpText) > 0 && setLumpText(fmtInput(parseAmount(lumpText)))}
              inputMode="decimal"
              rightSectionWidth={0}
            />
            <MonthPickerInput label={t("哪個月")} placeholder={t("選月份")} value={lumpMonth} onChange={setLumpMonth} clearable minDate={l.start} maxDate={l.end_date} />
          </SimpleGrid>
          <MonthPickerInput label={t("或者,想在哪個月還清")} placeholder={t("選月份")} value={finishBy} onChange={setFinishBy} clearable minDate={l.start} maxDate={l.end_date} />

          <SimpleGrid cols={{ base: 1, xs: inGrace ? 3 : 2 }} spacing="sm">
            <Res label={t("繳清日")} value={arrow(fmtDate(r.base.end_date), fmtDate(r.sim.end_date))} note={changed && r.sooner > 0 ? T`提前 ${r.sooner} 個月` : undefined} />
            <Res label={t("總利息")} value={arrow(money(r.base.interest), money(r.sim.interest))} note={changed && r.saved > 0 ? T`省 ${money(r.saved)}` : undefined} />
            {inGrace && (
              <Res label={t("寬限期後月付")} value={arrow(money(r.base.level), money(r.sim.level + r.extra))} note={changed && r.sim.level < r.base.level ? T`本金先還,跳得少` : undefined} />
            )}
          </SimpleGrid>
          {changed && r.perDollar > 0 && (
            <Text fz="xs" c="dimmed">
              {T`每多還 1 元,省 ${r.perDollar.toFixed(2)} 元利息。利率、期數照這筆貸款設定,實際以銀行為準。`}
            </Text>
          )}
        </Stack>
      </Collapse>
    </Stack>
  )
}

function Res({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Stack gap={0} miw={0}>
      <Text fz="xs" c="dimmed">
        {label}
      </Text>
      <Text className="num" fz="sm" style={{ overflowWrap: "anywhere" }}>
        {value}
      </Text>
      {note && (
        <Group gap={4}>
          <Text fz="xs" c="var(--wealth-up)" fw={600}>
            {note}
          </Text>
        </Group>
      )}
    </Stack>
  )
}
