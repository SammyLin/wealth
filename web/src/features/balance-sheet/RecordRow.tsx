import { useState } from "react"
import { Grid, Group, Loader, Text, TextInput } from "@mantine/core"
import type { Account, Kind } from "../../api/types"
import { useMoney } from "../../api/useLedger"
import { T, t } from "../../i18n"
import { fmtDate, fxShown } from "../../lib/format"
import { KindBadge } from "./AccountRow"
import { asOf, type Draft, type Parsed } from "./sheet"

type Props = {
  account: Account
  kind: Kind | undefined
  base: string
  date: string
  draft: Draft
  parsed: Parsed
  fxLoading: boolean
  initialFocus?: boolean
  /** Not updated for 90+ days: the hint says so, matching the hero's nudge that opened this dialog. */
  stale?: boolean
  amountRef: (el: HTMLInputElement | null) => void
  fxRef: (el: HTMLInputElement | null) => void
  onChange: (patch: Partial<Draft>) => void
  onPasteMany: (values: string[]) => void
  onAmountBlur: () => void
  /** Enter in either field: the modal decides where focus goes next (rate field, next row, or save). */
  onEnter: (from: "amt" | "fx") => void
}

export function RecordRow({ account: a, kind, base, date, draft, parsed, fxLoading, initialFocus, stale, amountRef, fxRef, onChange, onPasteMany, onAmountBlur, onEnter }: Props) {
  const money = useMoney()
  // the rate shows 6 significant digits so it fits the field on a phone; focused, the full precision is editable
  const [fxFocused, setFxFocused] = useState(false)
  const foreign = a.currency !== base
  const { point: last, exact } = asOf(a, date) // relative to the chosen day, not the latest record
  const delta = parsed.kind === "ok" ? parsed.delta : 0
  const hint =
    parsed.kind === "ok" && parsed.dirty && delta !== 0 ? (
      <Text fz="xs" className="num" c={delta > 0 ? "var(--wealth-up)" : "var(--wealth-down)"}>
        {T`淨資產 ${money(delta, { signed: true })}`}
      </Text>
    ) : (
      <Text fz="xs" c={stale && !exact ? "warn" : "dimmed"} className="num" truncate>
        {exact ? t("這天已有紀錄") : last ? (stale ? T`上次 ${fmtDate(last.date)} · 超過 90 天` : T`上次 ${fmtDate(last.date)}`) : t("尚未記錄")}
      </Text>
    )

  return (
    <Grid align="center" gap={{ base: 6, sm: "sm" }} py={8} style={{ borderTop: "1px solid var(--wealth-rule)" }}>
      <Grid.Col span={{ base: 12, sm: 5 }}>
        <Group gap={6} wrap="nowrap" miw={0}>
          <Text fz="sm" fw={500} truncate>
            {a.name}
          </Text>
          <KindBadge kind={kind} />
        </Group>
        {hint}
      </Grid.Col>
      <Grid.Col span={{ base: foreign ? 7 : 12, sm: foreign ? 4 : 7 }}>
        <TextInput
          ref={amountRef}
          data-autofocus={initialFocus || undefined}
          value={draft.amt}
          onChange={(e) => onChange({ amt: e.currentTarget.value })}
          onBlur={onAmountBlur}
          onFocus={(e) => e.currentTarget.select()}
          onPaste={(e) => {
            // Blank cells keep their place (that account is skipped, not shifted onto the next one);
            // only the trailing newline a spreadsheet adds is dropped.
            const values = e.clipboardData
              .getData("text")
              .replace(/\r?\n$/, "")
              .split(/\r?\n|\t/)
              .map((v) => v.trim())
            if (values.length < 2) return
            e.preventDefault()
            onPasteMany(values)
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return
            e.preventDefault()
            onEnter("amt")
          }}
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="next"
          placeholder={last ? t("沿用上一筆") : undefined /* the hint above already says "not recorded yet" */}
          aria-label={T`${a.name} 餘額(${a.currency})`}
          error={parsed.kind === "error" && parsed.field === "amt" ? t("看不懂這個數字") : undefined}
          rightSection={
            <Text fz="xs" c="dimmed">
              {a.currency}
            </Text>
          }
          rightSectionWidth={44}
          styles={{ input: { textAlign: "right", fontFamily: "var(--wealth-font-num)" } }}
        />
      </Grid.Col>
      {foreign && (
        <Grid.Col span={{ base: 5, sm: 3 }}>
          <TextInput
            ref={fxRef}
            value={fxShown(draft.fx, fxFocused)}
            onChange={(e) => onChange({ fx: e.currentTarget.value })}
            onFocus={(e) => {
              setFxFocused(true)
              const el = e.currentTarget
              requestAnimationFrame(() => el.select()) // after the full-precision text has replaced the rounded one
            }}
            onBlur={() => setFxFocused(false)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return
              e.preventDefault()
              onEnter("fx")
            }}
            inputMode="decimal"
            autoComplete="off"
            aria-label={T`${a.name} 匯率 ${a.currency}/${base}`}
            aria-busy={fxLoading}
            placeholder={fxLoading ? "" : t("匯率")}
            error={parsed.kind === "error" && parsed.field === "fx" ? (draft.fx.trim() ? t("匯率要大於 0") : t("請填匯率")) : undefined}
            leftSection={
              <Text fz="xs" c="dimmed" aria-hidden>
                ×
              </Text>
            }
            leftSectionWidth={24}
            rightSection={
              fxLoading ? (
                <Loader size={12} aria-label={t("正在取得匯率")} />
              ) : (
                <Text fz={12} c="dimmed" lh={1.1} ta="center">
                  {a.currency}
                  <br />/{base}
                </Text>
              )
            }
            rightSectionWidth={42}
            styles={{ input: { textAlign: "right", fontFamily: "var(--wealth-font-num)" } }}
          />
        </Grid.Col>
      )}
    </Grid>
  )
}
