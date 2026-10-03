import { useState } from "react"
import { Center, Input, SegmentedControl, Stack, Text, useMantineColorScheme, type MantineColorScheme } from "@mantine/core"
import { Monitor, Moon, Sun } from "lucide-react"
import { useLedgerState } from "../../api/useLedger"
import type { Unit } from "../../api/types"
import { T, t, useLang, type Lang } from "../../i18n"
import { fmtMoney } from "../../lib/format"

const SAMPLE = 12345678 // shows what each unit looks like

export function DisplaySettings() {
  const { state, saveSettings } = useLedgerState()
  const { lang, setLang } = useLang()
  const { colorScheme, setColorScheme } = useMantineColorScheme()
  // Show the picked unit at once; the server copy arrives after saveSettings refreshes state.
  const [pending, setPending] = useState<Unit | null>(null)
  const unit = pending ?? state.settings.unit

  const changeUnit = async (v: string) => {
    setPending(v as Unit)
    try {
      await saveSettings({ unit: v as Unit })
    } catch {
      /* useLedger already showed the error; the control falls back to the saved unit */
    } finally {
      setPending(null)
    }
  }

  const withIcon = (Icon: typeof Sun, label: string) => (
    <Center style={{ gap: 6 }}>
      <Icon size={14} aria-hidden />
      <span>{label}</span>
    </Center>
  )

  return (
    <Stack gap="md">
      <Input.Wrapper label={t("金額單位")} description={T`例:${fmtMoney(SAMPLE, unit, lang)}`}>
        <SegmentedControl
          mt={6}
          fullWidth
          value={unit}
          onChange={changeUnit}
          aria-label={t("金額單位")}
          data={[
            { value: "wan", label: t("萬") },
            { value: "k", label: "K / M" },
            { value: "full", label: t("完整") },
          ]}
        />
      </Input.Wrapper>

      <Input.Wrapper label={t("語言")}>
        <SegmentedControl
          mt={6}
          fullWidth
          value={lang}
          onChange={(v) => setLang(v as Lang)}
          aria-label={t("語言")}
          data={[
            { value: "zh", label: "中文" },
            { value: "en", label: "English" },
          ]}
        />
      </Input.Wrapper>

      <Input.Wrapper label={t("外觀")}>
        <SegmentedControl
          mt={6}
          fullWidth
          value={colorScheme}
          onChange={(v) => setColorScheme(v as MantineColorScheme)}
          aria-label={t("外觀")}
          data={[
            { value: "light", label: withIcon(Sun, t("淺色")) },
            { value: "dark", label: withIcon(Moon, t("深色")) },
            { value: "auto", label: withIcon(Monitor, t("跟隨系統")) },
          ]}
        />
      </Input.Wrapper>
      <Text c="dimmed" fz="xs">
        {t("語言和外觀只存在這台裝置;金額單位存在帳本裡。")}
      </Text>
    </Stack>
  )
}
