import { useState } from "react"
import { Anchor, Autocomplete, Button, Card, EmptyState, Group, Input, SegmentedControl, SimpleGrid, Stack, Text } from "@mantine/core"
import { notifications } from "@mantine/notifications"
import { FileUp, Plus, Sprout } from "lucide-react"
import { useLedgerState } from "../api/useLedger"
import type { Settings, Unit } from "../api/types"
import { T, t, useLang } from "../i18n"
import { CURRENCIES, CURRENCY_RE, fmtMoney } from "../lib/format"
import { SEEDED } from "../lib/kinds"
import { askConfirm } from "./confirm"
import { loadDemo } from "./demo"
import { useOpenDialog } from "./dialogs"

// Countries whose currency a browser locale implies; anything else keeps the server default.
const REGION_CURRENCY: Record<string, string> = {
  TW: "TWD", US: "USD", GB: "GBP", JP: "JPY", CN: "CNY", HK: "HKD", MO: "MOP", SG: "SGD", AU: "AUD", CA: "CAD", NZ: "NZD",
  KR: "KRW", CH: "CHF", TH: "THB", MY: "MYR", VN: "VND", IN: "INR", DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR",
  NL: "EUR", IE: "EUR", AT: "EUR", BE: "EUR", PT: "EUR", FI: "EUR", GR: "EUR",
}

/**
 * The browser region's currency, but only while the UI language is the browser's own: someone on an en-US
 * system who switched the UI to 中文 may well count in TWD, so the choice is left to them instead of
 * preselecting USD.
 */
function localCurrency(lang: string): string | undefined {
  try {
    const loc = new Intl.Locale(navigator.language)
    if ((loc.language === "zh") !== (lang === "zh")) return undefined
    const region = loc.maximize().region
    return region ? REGION_CURRENCY[region] : undefined
  } catch {
    return undefined
  }
}

// A ledger outside Taiwan gets class names that fit it better: "TW stocks" / "US stocks" become "Stocks" /
// "Foreign stocks" (keys stay; only names change).
const NON_TWD: Record<string, string> = { tw_stock: "股票", us_stock: "海外股票" }

/**
 * Empty ledger: settle the two things that are hard to change later (the base currency locks with the first
 * balance), defaulting from the browser locale, then start adding accounts.
 */
export function FirstRun() {
  const open = useOpenDialog()
  const { state, saveSettings, updateKind, refresh } = useLedgerState()
  const { lang } = useLang()
  const s = state.settings
  const [base, setBase] = useState<string | null>(null)
  const [unit, setUnit] = useState<Unit | null>(null)
  const [busy, setBusy] = useState(false)
  // English speakers rarely count in 萬; the stored default is 萬 because the app started in Taiwan.
  const guess = localCurrency(lang)
  const baseNow = base ?? (guess || (navigator.language.startsWith("zh") === (lang === "zh") ? s.base_currency : ""))
  const unitNow = unit ?? (lang === "en" && s.unit === "wan" ? "k" : s.unit)
  const validBase = CURRENCY_RE.test(baseNow)

  // Settings, plus the seeded class names that fit the base currency, then on to adding accounts or importing a
  // spreadsheet. Untouched defaults stay as their Chinese keys, which every view translates (t()), so a ledger
  // started in English still reads in Chinese for a 中文 viewer and the other way round.
  const start = async (next: "accounts" | "import") => {
    if (await settle(baseNow)) open(next)
  }

  const settle = async (baseNow: string) => {
    const patch: Partial<Settings> = {}
    if (baseNow !== s.base_currency) patch.base_currency = baseNow
    if (unitNow !== s.unit) patch.unit = unitNow
    const renames = state.kinds.flatMap((k) => {
      if (SEEDED[k.key] !== k.name) return [] // renamed by the user already
      const name = (baseNow !== "TWD" && NON_TWD[k.key]) || k.name
      return name === k.name ? [] : [{ ...k, name }]
    })
    setBusy(true)
    try {
      for (const { key, ...k } of renames) await updateKind(key, k)
      if (Object.keys(patch).length) await saveSettings(patch)
      return true
    } catch {
      return false /* useLedger already showed the error */
    } finally {
      setBusy(false)
    }
  }

  // A sample household (TWD base, two USD accounts, a mortgage) written into this empty ledger, for trying the
  // app out. Settings (and the dashboard banner) offer to clear it again.
  const askDemo = () =>
    askConfirm({
      title: t("載入範例帳本?"),
      body: t("會把一個範例家庭(8 個帳戶、30 個月的餘額、房貸和大事)寫進這個帳本,基準幣別設為 TWD。看完可以在儀表板或「設定」一鍵清除範例資料。"),
      confirm: t("載入範例"),
      onConfirm: async () => {
        if (!(await settle("TWD"))) return
        setBusy(true)
        try {
          await loadDemo(lang === "en")
        } catch (e) {
          notifications.show({ color: "down", title: t("操作失敗"), message: (e as Error).message })
        } finally {
          await refresh()
          setBusy(false)
        }
      },
    })

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
                placeholder={t("例如 TWD、USD")}
                error={validBase || !baseNow ? undefined : t("基準幣別要是三個英文字母,例如 TWD、USD")}
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
            <Group justify="center" mt="sm" gap="sm">
              <Button leftSection={<Plus size={16} />} loading={busy} disabled={!validBase} onClick={() => start("accounts")}>
                {t("新增帳戶")}
              </Button>
              <Button variant="default" leftSection={<FileUp size={16} />} disabled={!validBase || busy} onClick={() => start("import")}>
                {t("從 CSV 匯入")}
              </Button>
            </Group>
            <Text fz="xs" c="dimmed" ta="center">
              {t("只是想先看看?")}{" "}
              <Anchor component="button" type="button" fz="inherit" disabled={busy} onClick={askDemo}>
                {t("載入範例帳本")}
              </Anchor>
            </Text>
          </Stack>
        </EmptyState.Actions>
      </EmptyState>
    </Card>
  )
}
