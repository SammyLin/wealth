import { useState, type Ref } from "react"
import { Button, ColorInput, Group, Select, SimpleGrid, Text, TextInput } from "@mantine/core"
import { useForm } from "@mantine/form"
import { notifications } from "@mantine/notifications"
import { Check } from "lucide-react"
import { useLedgerState } from "../../api/useLedger"
import type { Liquidity } from "../../api/types"
import { T, t } from "../../i18n"
import { HEX_RE } from "../../lib/format"
import { LIQUIDITY } from "../../lib/liquidity"
import { useDirty } from "../../shell/dirty"
import { slugKey, SWATCHES } from "./logic"

/**
 * New account class. Its internal key is derived from the name (slugKey) and never shown. The list focuses
 * `nameRef` once its Collapse has opened (focusing earlier, while the panel is still hidden, drops focus to body).
 */
export function KindForm({ onDone, nameRef }: { onDone: () => void; nameRef?: Ref<HTMLInputElement> }) {
  const { state, createKind } = useLedgerState()
  const taken = state.kinds.map((k) => k.key)
  const [saving, setSaving] = useState(false)
  const form = useForm({
    initialValues: {
      name: "",
      color: SWATCHES.find((c) => !state.kinds.some((k) => k.color.toLowerCase() === c)) ?? SWATCHES[0],
      liquidity: "invest" as Liquidity,
    },
    validate: {
      name: (v) =>
        !v.trim() || v.trim().length > 30
          ? t("類別名稱必填,最多 30 字")
          : state.kinds.some((k) => [k.name, t(k.name)].some((n) => n.toLowerCase() === v.trim().toLowerCase()))
            ? t("已經有同名的類別")
            : null,
      color: (v) => (HEX_RE.test(v) ? null : t("顏色格式要是 #rrggbb")),
    },
  })

  useDirty(form.isDirty())

  const submit = form.onSubmit(async (v) => {
    setSaving(true)
    try {
      const sort = Math.max(-1, ...state.kinds.map((k) => k.sort)) + 1
      const k = await createKind({ key: slugKey(v.name, taken, v.liquidity), name: v.name.trim(), color: v.color.toLowerCase(), liquidity: v.liquidity, sort })
      notifications.show({ message: T`已新增類別「${k.name}」`, icon: <Check size={16} /> })
      onDone()
    } catch {
      setSaving(false) // useLedger already showed the error
    }
  })

  return (
    <form onSubmit={submit} noValidate>
      <Text ff="heading" fw={600} mb="sm">
        {t("新增類別")}
      </Text>
      <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="sm" verticalSpacing="sm">
        <TextInput label={t("名稱")} placeholder={t("例如:保險、退休金")} required maxLength={30} ref={nameRef} {...form.getInputProps("name")} />
        <ColorInput label={t("顏色")} required swatches={SWATCHES} swatchesPerRow={10} withEyeDropper={false} {...form.getInputProps("color")} />
        <Select
          label={t("流動性")}
          description={t("「負債」會從淨資產扣掉")}
          allowDeselect={false}
          searchable
          selectFirstOptionOnChange
          data={LIQUIDITY.map((l) => ({ value: l.value, label: t(l.label) }))}
          {...form.getInputProps("liquidity")}
        />
      </SimpleGrid>
      <Group justify="flex-end" mt="md" gap="sm">
        <Button variant="default" onClick={onDone}>
          {t("取消")}
        </Button>
        <Button type="submit" loading={saving}>
          {t("新增")}
        </Button>
      </Group>
    </form>
  )
}
