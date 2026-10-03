import { useEffect, useState } from "react"
import { useMediaQuery } from "@mantine/hooks"
import { Button, Group, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Text, TextInput } from "@mantine/core"
import { DatePickerInput } from "@mantine/dates"
import { useForm } from "@mantine/form"
import { notifications } from "@mantine/notifications"
import { CalendarDays, Check } from "lucide-react"
import type { LoanInput, LoanView } from "../../api/types"
import { useLedgerState, useMoney } from "../../api/useLedger"
import { T, t, useLang } from "../../i18n"
import { fmtDate, fmtInput, fmtMoney, parseAmount, todayISO } from "../../lib/format"
import { fmtTerm } from "./labels"
import { addMonths, gracePayment, levelPayment, loanErrors, pctToRate, rateToPct, totalInterest } from "./math"
import { Stat } from "../../shell/Stat"
import { useDirty, useGuardedClose } from "../../shell/dirty"

type Values = {
  name: string
  account_id: string | null
  principal: string // typed text: "12,800,000" or "1280萬"
  rate: number | string // percent
  start: string | null
  grace_months: number | string
  total_months: number | string
}

const initial = (l?: LoanView | null): Values => ({
  name: l?.name ?? "",
  account_id: l?.account_id ? String(l.account_id) : null,
  principal: l ? fmtInput(l.principal) : "",
  rate: l ? rateToPct(l.rate) : "",
  start: l?.start ?? todayISO(),
  grace_months: l?.grace_months ?? 0,
  total_months: l?.total_months ?? 360,
})

const toLoan = (v: Values): LoanInput => ({
  name: v.name.trim(),
  account_id: v.account_id ? Number(v.account_id) : null,
  principal: parseAmount(v.principal),
  rate: v.rate === "" ? NaN : pctToRate(Number(v.rate)),
  start: v.start ?? "",
  grace_months: v.grace_months === "" ? NaN : Number(v.grace_months),
  total_months: v.total_months === "" ? NaN : Number(v.total_months),
})

// validLoan()'s rules and messages (shared cases in testdata/loans.json), attached to the field at fault.
const validate = (v: Values) => Object.fromEntries(Object.entries(loanErrors(toLoan(v))).map(([k, msg]) => [k, t(msg)]))

type Props = { opened: boolean; onClose: () => void; loan?: LoanView | null }

export function LoanModal({ opened, onClose, loan }: Props) {
  const { state, saveLoan } = useLedgerState()
  const money = useMoney()
  const { lang } = useLang()
  const fullScreen = useMediaQuery("(max-width: 48em)")
  const [saving, setSaving] = useState(false)
  const form = useForm<Values>({ initialValues: initial(loan), validate })
  // Esc, X, the backdrop and Cancel ask before dropping typed loan terms, like the other dialogs
  const { dirty, close } = useGuardedClose(onClose)
  useDirty(opened && form.isDirty(), dirty)

  useEffect(() => {
    if (!opened) return
    form.setValues(initial(loan))
    form.resetDirty(initial(loan))
    form.clearErrors()
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens or the loan changes
  }, [opened, loan])

  const liabilityKinds = new Set(state.kinds.filter((k) => k.liquidity === "liability").map((k) => k.key))
  const accounts = state.accounts
    .filter((a) => liabilityKinds.has(a.kind) && (!a.archived || a.id === loan?.account_id))
    .map((a) => ({ value: String(a.id), label: a.name }))

  const submit = async (v: Values) => {
    const l = toLoan(v)
    setSaving(true)
    try {
      await saveLoan({ ...l, id: loan?.id })
      notifications.show({ icon: <Check size={16} />, message: loan ? T`已更新貸款「${l.name}」` : T`已新增貸款「${l.name}」` })
      onClose()
    } catch {
      /* useLedger already showed the error; keep the dialog open */
    } finally {
      setSaving(false)
    }
  }

  const l = toLoan(form.values)
  const months = Number.isInteger(l.total_months) && l.total_months > 0 ? l.total_months : 0

  return (
    <Modal opened={opened} onClose={close} title={t(loan ? "編輯貸款" : "新增貸款")} size="lg" fullScreen={fullScreen}>
      <form onSubmit={form.onSubmit(submit)} noValidate>
        <Stack gap="md">
          <Text fz="sm" c="dimmed">
            {t("一筆房貸若分好幾段(不同利率或起始日),每段各新增一次,並連結到同一個負債帳戶。")}
          </Text>
          <TextInput label={t("名稱")} placeholder={t("例:房貸 第一段、車貸")} maxLength={40} withAsterisk data-autofocus {...form.getInputProps("name")} />
          <Select
            label={t("屬於哪個負債帳戶")}
            placeholder={t("(不連結)")}
            data={accounts}
            clearable
            description={accounts.length ? undefined : t("先在「帳戶與類別」新增負債帳戶,就能把貸款連結過去。")}
            {...form.getInputProps("account_id")}
          />
          <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="md">
            <TextInput
              label={t("本金")}
              placeholder="12,800,000"
              inputMode="decimal"
              withAsterisk
              description={l.principal > 0 ? T`= ${money(l.principal)}` : t("可輸入 1280萬 這種寫法")}
              {...form.getInputProps("principal")}
              onBlur={(e) => {
                const p = parseAmount(e.currentTarget.value)
                if (p > 0) form.setFieldValue("principal", fmtInput(p))
                form.validateField("principal")
              }}
            />
            <NumberInput label={t("年利率")} placeholder="2.185" suffix="%" decimalScale={4} min={0} max={20} step={0.01} withAsterisk {...form.getInputProps("rate")} />
          </SimpleGrid>
          <DatePickerInput
            label={t("起始日(撥款日)")}
            leftSection={<CalendarDays size={16} aria-hidden />}
            withAsterisk
            description={t("第一期在撥款的下個月繳")}
            {...form.getInputProps("start")}
          />
          <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="md">
            <NumberInput
              label={t("寬限期(月)")}
              description={t("只繳利息的月數,沒有就填 0")}
              allowDecimal={false}
              min={0}
              max={599}
              {...form.getInputProps("grace_months")}
            />
            <NumberInput
              label={t("總期數(月)")}
              description={months ? T`共 ${fmtTerm(months)},含寬限期` : " "}
              allowDecimal={false}
              min={1}
              max={600}
              withAsterisk
              {...form.getInputProps("total_months")}
            />
          </SimpleGrid>

          <Preview loan={l} money={money} exact={(v) => fmtMoney(v, "full", lang)} />

          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={close}>
              {t("取消")}
            </Button>
            <Button type="submit" loading={saving}>
              {t(loan ? "儲存" : "新增")}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}

type Fmt = (v: number) => string

/** Live payment preview, same formula as the server. Payments in full digits: that is what the bank debits. */
function Preview({ loan: l, money, exact }: { loan: LoanInput; money: Fmt; exact: Fmt }) {
  const ok = l.principal > 0 && l.rate >= 0 && l.rate <= 0.2 && l.grace_months >= 0 && l.total_months - l.grace_months > 0
  return (
    <Paper p="md" radius="md" bg="var(--wealth-paper-2)" aria-live="polite">
      {ok ? (
        <SimpleGrid cols={{ base: 2, xs: l.grace_months > 0 ? 4 : 3 }} spacing="sm">
          {l.grace_months > 0 && <Stat label={t("寬限期月付")} value={exact(gracePayment(l))} />}
          <Stat label={l.grace_months > 0 ? t("之後月付") : t("月付")} value={exact(levelPayment(l))} />
          <Stat label={t("總利息")} value={money(totalInterest(l))} />
          {/^\d{4}-\d{2}-\d{2}$/.test(l.start) && <Stat label={t("繳清日")} value={fmtDate(addMonths(l.start, l.total_months))} />}
        </SimpleGrid>
      ) : (
        <Text fz="sm" c="dimmed">
          {t("填好本金、利率和期數,這裡會算出每月要繳多少。")}
        </Text>
      )}
    </Paper>
  )
}
