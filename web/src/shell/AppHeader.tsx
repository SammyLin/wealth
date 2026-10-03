import { ActionIcon, Box, Button, Container, Group, Menu, Skeleton, Text, ThemeIcon, Tooltip, UnstyledButton, useComputedColorScheme, useMantineColorScheme } from "@mantine/core"
import { BookOpenText, Ellipsis, Languages, Moon, PenLine, Settings, Sun, WalletCards } from "lucide-react"
import { useLedger } from "../api/useLedger"
import { t, useLang } from "../i18n"
import { useOpenDialog } from "./dialogs"

export function AppHeader() {
  const { state, loading } = useLedger()
  const { lang, setLang } = useLang()
  const open = useOpenDialog()
  const { setColorScheme } = useMantineColorScheme()
  const dark = useComputedColorScheme("light", { getInitialValueInEffect: false }) === "dark"

  const ready = !!state
  const canRecord = !!state?.accounts.some((a) => !a.archived)
  const otherLang = lang === "en" ? "zh" : "en"
  const langLabel = lang === "en" ? "中文" : "EN"
  const schemeLabel = dark ? t("淺色模式") : t("深色模式")
  const SchemeIcon = dark ? Sun : Moon
  const toggleScheme = () => setColorScheme(dark ? "light" : "dark")

  return (
    <Container size="lg" h="100%">
      <Group h="100%" justify="space-between" wrap="nowrap" gap="md">
        <UnstyledButton miw={0} onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          <Group gap="sm" wrap="nowrap">
          <ThemeIcon size={34} radius={10} color={dark ? "gold.5" : "gray.9"} aria-hidden>
            <BookOpenText size={18} color={dark ? "var(--mantine-color-dark-8)" : "var(--mantine-color-gold-1)"} />
          </ThemeIcon>
          <Box miw={0}>
            {loading && !state ? (
              <Skeleton h={16} w={120} />
            ) : (
              <>
                <Text ff="heading" fw={600} fz="md" lh={1.2} lts=".02em" truncate>
                  {state ? t(state.settings.title) : "wealth"}
                </Text>
                {state?.settings.subtitle && (
                  <Text c="dimmed" fz="xs" lts=".06em" truncate visibleFrom="xs">
                    {t(state.settings.subtitle)}
                  </Text>
                )}
              </>
            )}
          </Box>
          </Group>
        </UnstyledButton>

        <Group gap={6} wrap="nowrap">
          <Group gap={4} wrap="nowrap" visibleFrom="sm">
            <Tooltip label={t("帳戶與類別")}>
              <ActionIcon size="lg" aria-label={t("帳戶與類別")} disabled={!ready} onClick={() => open("accounts")}>
                <WalletCards size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t("設定")}>
              <ActionIcon size="lg" aria-label={t("設定")} disabled={!ready} onClick={() => open("settings")}>
                <Settings size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t("切換語言")}>
              <Button variant="subtle" color="gray" size="compact-sm" fw={500} lts=".04em" aria-label={`${langLabel} · ${t("切換語言")}`} onClick={() => setLang(otherLang)}>
                <span lang={otherLang === "en" ? "en" : "zh-Hant"}>{langLabel}</span>
              </Button>
            </Tooltip>
            <Tooltip label={schemeLabel}>
              <ActionIcon size="lg" aria-label={schemeLabel} onClick={toggleScheme}>
                <SchemeIcon size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>

          <Button leftSection={<PenLine size={16} />} disabled={!canRecord} onClick={() => open("record")}>
            {t("記一筆")}
          </Button>

          <Menu position="bottom-end" width={200}>
            <Menu.Target>
              <ActionIcon size="lg" aria-label={t("更多")} hiddenFrom="sm">
                <Ellipsis size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<WalletCards size={16} />} disabled={!ready} onClick={() => open("accounts")}>
                {t("帳戶與類別")}
              </Menu.Item>
              <Menu.Item leftSection={<Settings size={16} />} disabled={!ready} onClick={() => open("settings")}>
                {t("設定")}
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item leftSection={<Languages size={16} />} onClick={() => setLang(otherLang)} lang={otherLang === "en" ? "en" : "zh-Hant"}>
                {langLabel}
              </Menu.Item>
              <Menu.Item leftSection={<SchemeIcon size={16} />} onClick={toggleScheme}>
                {schemeLabel}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
    </Container>
  )
}
