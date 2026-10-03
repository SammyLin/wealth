import { useState } from "react"
import { Autocomplete, Button, Card, EmptyState, Group, Input, SegmentedControl, SimpleGrid, Stack, Text } from "@mantine/core"
import { Plus, Sprout } from "lucide-react"
import { useLedgerState } from "../api/useLedger"
import type { Settings, Unit } from "../api/types"
import { T, t, useLang } from "../i18n"
import { CURRENCIES, fmtMoney } from "../lib/format"
import { useOpenDialog } from "./dialogs"

// Countries whose currency a browser locale implies; anything else keeps the server default.
const REGION_CURRENCY: Record<string, string> = {
  TW: "TWD", US: "USD", GB: "GBP", JP: "JPY", CN: "CNY", HK: "HKD", MO: "MOP", SG: "SGD", AU: "AUD", CA: "CAD", NZ: "NZD",
  KR: "KRW", CH: "CHF", TH: "THB", MY: "MYR", VN: "VND", IN: "INR", DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR",
  NL: "EUR", IE: "EUR", AT: "EUR", BE: "EUR", PT: "EUR", FI: "EUR", GR: "EUR",
}

function localCurrency(): string | undefined {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region
    return region ? REGION_CURRENCY[region] : undefined
  } catch {
    return undefined
  }
}

/**
 * Empty ledger: settle the two things that are hard to change later (the base currency locks with the first
 * balance), defaulting from the browser locale, then start adding accounts.
 */
export function FirstRun() {
  const open = useOpenDialog()
  const { state, saveSettings } = useLedgerState()
  const { lang } = useLang()
  const s = state.settings
  const [base, setBase] = useState<string | null>(null)
  const [unit, setUnit] = useState<Unit | null>(null)
  const [busy, setBusy] = useState(false)
  // English speakers rarely count in 萬; the stored default is 萬 because the app started in Taiwan.
  const baseNow = base ?? localCurrency() ?? s.base_currency
  const unitNow = unit ?? (lang === "en" && s.unit === "wan" ? "k" : s.unit)
  const validBase = /^[A-Z]{3}$/.test(baseNow)

  const start = async () => {
    const patch: Partial<Settings> = {}
    if (baseNow !== s.base_currency) patch.base_currency = baseNow
    if (unitNow !== s.unit) patch.unit = unitNow
    setBusy(true)
    try {
      if (Object.keys(patch).length) await saveSettings(patch)
      open("accounts")
    } catch {
      /* useLedger already showed the error */
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card mt={{ base: "lg", sm: 48 }} py={48}>
      <EmptyState
        size="lg"
        variant="light"
        icon={<Sprout size={28} />}
        title={t("從第一個帳戶開始")}
        description={t("銀行、台股、美股、房子、車、房貸都算。之後每次只要更新餘額。")}
      >
        <EmptyState.Actions>
          <Stack gap="md" maw={460} mx="auto" w="100%" ta="left">
            <Text fz="sm" fw={600}>
              {t("先決定兩件事")}
            </Text>
            <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="md">
              <Autocomplete
                label={t("基準幣別")}
                description={t("所有金額都換算成這個幣別;記下第一筆餘額後就不能改。")}
                data={[...new Set([baseNow, ...CURRENCIES])]}
                value={baseNow}
                onChange={(v) => setBase(v.toUpperCase().slice(0, 3))}
                maxLength={3}
                autoCapitalize="characters"
                spellCheck={false}
                error={validBase ? undefined : t("基準幣別要是三個英文字母,例如 TWD、USD")}
              />
              <Input.Wrapper
                label={t("金額單位")}
                description={
                  <>
                    {T`例:${fmtMoney(12345678, unitNow, lang)}`}
                    <br />
                    {t("之後都能在「設定」改單位。")}
                  </>
                }
              >
                <SegmentedControl
                  mt={6}
                  fullWidth
                  value={unitNow}
                  onChange={(v) => setUnit(v as Unit)}
                  aria-label={t("金額單位")}
                  data={[
                    { value: "wan", label: t("萬") },
                    { value: "k", label: "K / M" },
                    { value: "full", label: t("完整") },
                  ]}
                />
              </Input.Wrapper>
            </SimpleGrid>
            <Group justify="center" mt="sm">
              <Button leftSection={<Plus size={16} />} loading={busy} disabled={!validBase} onClick={start}>
                {t("新增帳戶")}
              </Button>
            </Group>
          </Stack>
        </EmptyState.Actions>
      </EmptyState>
    </Card>
  )
}
