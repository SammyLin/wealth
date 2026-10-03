import { useState } from "react"
import { Autocomplete, ColorSwatch, Group, Select, type AutocompleteProps, type SelectProps } from "@mantine/core"
import { useLedgerState } from "../../api/useLedger"
import { T, t } from "../../i18n"
import { CURRENCIES } from "../../lib/format"
import { staleSearch } from "./logic"

/**
 * Select of the user's kinds; the swatch is a second cue next to the name, never the only one.
 * Type-ahead: typing "Lia" highlights the first match, and Enter or Tab commits it. Enter never submits the
 * form while the typed text isn't a kind's name: Mantine only stops Enter when an option is highlighted, so a
 * half-typed or unmatched name would otherwise submit with the previous kind (a credit card saved as a bank).
 * Text that matches no kind says so inline, and the swatch clears, instead of Enter silently doing nothing.
 */
export function KindSelect(props: Omit<SelectProps, "data">) {
  const { state } = useLedgerState()
  const color = (key?: string | null) => state.kinds.find((k) => k.key === key)?.color ?? "transparent"
  const data = state.kinds.map((k) => ({ value: k.key, label: t(k.name) }))
  const [search, setSearch] = useState<string | null>(null) // null until the user types
  const typed = search?.trim().toLowerCase()
  const noMatch = !!typed && !data.some((d) => d.label.toLowerCase().includes(typed))
  return (
    <Select
      allowDeselect={false}
      searchable
      selectFirstOptionOnChange
      autoSelectOnBlur
      {...props}
      onSearchChange={setSearch}
      error={noMatch ? T`沒有叫「${search!.trim()}」的類別` : props.error}
      onKeyDown={(e) => {
        if (e.key === "Enter" && staleSearch(e.currentTarget.value, props.value, data)) e.preventDefault()
        props.onKeyDown?.(e)
      }}
      data={data}
      leftSection={<ColorSwatch size={12} color={noMatch ? "transparent" : color(props.value)} withShadow={false} />}
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
      // select on focus, so typing "EUR" replaces the prefilled base currency instead of being cut off at 3 letters
      onFocus={(e) => {
        e.currentTarget.select()
        props.onFocus?.(e)
      }}
      onChange={(v) => props.onChange?.(v.toUpperCase())}
    />
  )
}
