import { useState } from "react"
import { Autocomplete, Button, Group, Stack, TextInput } from "@mantine/core"
import { useForm } from "@mantine/form"
import { notifications } from "@mantine/notifications"
import { Check, Lock, Save } from "lucide-react"
import type { Settings } from "../../api/types"
import { useLedgerState } from "../../api/useLedger"
import { t } from "../../i18n"
import { CURRENCIES } from "../../lib/format"
import { useDirty } from "../../shell/dirty"
const MAX_TEXT = 60 // server limit for title / subtitle (runes)

export function LedgerSettings() {
  const { state, saveSettings } = useLedgerState()
  const s = state.settings
  // Every stored fx is relative to the base currency, so the server locks it once a balance exists.
  const locked = state.accounts.some((a) => a.history.length > 0)
  const [saving, setSaving] = useState(false)
  // The stored default title is a Chinese key, shown translated; only fields the user changed are saved, so
  // editing the subtitle in English never writes "My ledger" over the key.
  const shown = { title: t(s.title), subtitle: t(s.subtitle), base_currency: s.base_currency }
  const form = useForm({
    initialValues: shown,
    validate: {
      title: (v) => (v.trim() ? null : t("名稱不能空白")),
      base_currency: (v) => (/^[A-Za-z]{3}$/.test(v.trim()) ? null : t("基準幣別要是三個英文字母,例如 TWD、USD")),
    },
  })

  useDirty(form.isDirty())

  const submit = form.onSubmit(async (v) => {
    setSaving(true)
    try {
      const next = { title: v.title.trim(), subtitle: v.subtitle.trim(), base_currency: v.base_currency.trim().toUpperCase() }
      const patch: Partial<Settings> = {}
      if (next.title !== shown.title) patch.title = next.title
      if (next.subtitle !== shown.subtitle) patch.subtitle = next.subtitle
      if (!locked && next.base_currency !== shown.base_currency) patch.base_currency = next.base_currency
      if (Object.keys(patch).length) await saveSettings(patch)
      form.setValues(next)
      form.resetDirty(next)
      notifications.show({ color: "up", icon: <Check size={16} />, message: t("已儲存設定") })
    } catch {
      /* useLedger already showed the error */
    } finally {
      setSaving(false)
    }
  })

  return (
    <form onSubmit={submit}>
      <Stack gap="sm">
        <TextInput label={t("帳本名稱")} maxLength={MAX_TEXT} required {...form.getInputProps("title")} />
        <TextInput label={t("副標")} maxLength={MAX_TEXT} {...form.getInputProps("subtitle")} />
        <Autocomplete
          label={t("基準幣別")}
          description={locked ? t("已經有餘額紀錄,基準幣別不能再改。") : t("所有金額都換算成這個幣別。開始記帳後就不能改。")}
          data={CURRENCIES}
          maxLength={3}
          disabled={locked}
          rightSection={locked ? <Lock size={14} aria-hidden /> : undefined}
          autoCapitalize="characters"
          {...form.getInputProps("base_currency")}
        />
        <Group justify="flex-end">
          <Button type="submit" leftSection={<Save size={16} />} loading={saving} disabled={!form.isDirty()}>
            {t("儲存")}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}
