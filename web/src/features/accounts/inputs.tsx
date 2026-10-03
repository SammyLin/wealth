import { Autocomplete, ColorSwatch, Group, Select, type AutocompleteProps, type SelectProps } from "@mantine/core"
import { useLedgerState } from "../../api/useLedger"
import { t } from "../../i18n"
import { CURRENCIES } from "../../lib/format"

/** Select of the user's kinds; the swatch is a second cue next to the name, never the only one. */
export function KindSelect(props: Omit<SelectProps, "data">) {
  const { state } = useLedgerState()
  const color = (key?: string | null) => state.kinds.find((k) => k.key === key)?.color ?? "transparent"
  return (
    <Select
      allowDeselect={false}
      {...props}
      data={state.kinds.map((k) => ({ value: k.key, label: t(k.name) }))}
      leftSection={<ColorSwatch size={12} color={color(props.value)} withShadow={false} />}
      renderOption={({ option }) => (
        <Group gap="xs" wrap="nowrap">
          <ColorSwatch size={12} color={color(option.value)} withShadow={false} />
          {option.label}
        </Group>
      )}
    />
  )
}

/** Three-letter ISO code with the base currency and the ones already in use suggested first. */
export function CurrencyInput(props: Omit<AutocompleteProps, "data">) {
  const { state } = useLedgerState()
  const data = [...new Set([state.settings.base_currency, ...state.accounts.map((a) => a.currency), ...CURRENCIES])]
  return (
    <Autocomplete
      maxLength={3}
      autoCapitalize="characters"
      spellCheck={false}
      {...props}
      data={data}
      onChange={(v) => props.onChange?.(v.toUpperCase())}
    />
  )
}
