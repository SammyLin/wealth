import { lazy, Suspense, useCallback, useEffect, useState } from "react"
import { DatesProvider } from "@mantine/dates"
import { useHotkeys } from "@mantine/hooks"
import "dayjs/locale/zh-tw"
import { Alert, AppShell, Button, Card, Container, Skeleton, Stack, Text } from "@mantine/core"
import { CloudOff, RotateCw } from "lucide-react"
import { LedgerProvider, useLedger } from "./api/useLedger"
import { t, useLang } from "./i18n"
import { AppHeader } from "./shell/AppHeader"
import { DialogContext, type AccountTarget, type Dialog } from "./shell/dialogs"
import { DemoBanner } from "./shell/demo"
import { FirstRun } from "./shell/FirstRun"
import { SectionNumber } from "./shell/SectionCard"
import { useLayout } from "./shell/sections"
import { useUndoShortcut } from "./shell/undo"
import { Overview } from "./features/overview/Hero"
import { RangeProvider } from "./features/overview/range"

// Dialogs load on first open (they carry @mantine/dates, the form library and the CSV preview), which keeps
// them out of the entry chunk; once loaded they stay mounted so close transitions still play.
const RecordModal = lazy(() => import("./features/balance-sheet/RecordModal").then((m) => ({ default: m.RecordModal })))
const AccountsManager = lazy(() => import("./features/accounts").then((m) => ({ default: m.AccountsManager })))
const SettingsDrawer = lazy(() => import("./features/settings").then((m) => ({ default: m.SettingsDrawer })))
const ImportDialog = lazy(() => import("./features/settings").then((m) => ({ default: m.ImportDialog })))

export default function App() {
  const { lang } = useLang() // re-renders the whole tree when the language changes
  return (
    <DatesProvider settings={{ locale: lang === "en" ? "en" : "zh-tw" }}>
      <LedgerProvider>
        <Shell />
      </LedgerProvider>
    </DatesProvider>
  )
}

function Shell() {
  const { state } = useLedger()
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [loaded, setLoaded] = useState<Dialog["name"][]>([])
  const open = useCallback((name: Dialog["name"], accountId?: AccountTarget) => {
    setDialog({ name, accountId })
    setLoaded((l) => (l.includes(name) ? l : [...l, name]))
  }, [])
  const close = () => setDialog(null)
  useUndoShortcut()
  // R opens 記一筆 from the dashboard (not over another dialog, whose unsaved edits it would drop)
  useHotkeys([["r", () => !dialog && state?.accounts.some((a) => !a.archived) && open("record")]])

  useEffect(() => {
    if (state) document.title = t(state.settings.title)
  })

  return (
    <DialogContext.Provider value={open}>
      <a className="skip-link" href="#main">
        {t("跳到內容")}
      </a>
      <AppShell header={{ height: 64 }}>
        <AppShell.Header>
          <AppHeader />
        </AppShell.Header>
        <AppShell.Main id="main">
          <Container size="lg" pb={64}>
            <Body />
          </Container>
        </AppShell.Main>
      </AppShell>
      {state && (
        <>
          {/* one boundary each, so loading one dialog never blanks another that is already open */}
          <Suspense fallback={null}>{loaded.includes("record") && <RecordModal opened={dialog?.name === "record"} onClose={close} />}</Suspense>
          <Suspense fallback={null}>{loaded.includes("settings") && <SettingsDrawer opened={dialog?.name === "settings"} onClose={close} />}</Suspense>
          <Suspense fallback={null}>
            {loaded.includes("accounts") && <AccountsManager opened={dialog?.name === "accounts"} accountId={dialog?.accountId} onClose={close} />}
          </Suspense>
          <Suspense fallback={null}>{loaded.includes("import") && <ImportDialog opened={dialog?.name === "import"} onClose={close} />}</Suspense>
        </>
      )}
    </DialogContext.Provider>
  )
}

function Body() {
  const { state, error } = useLedger()
  const { visible } = useLayout()
  if (!state) return error ? <LoadError error={error} /> : <Loading />
  // a refresh that failed after the data loaded: keep showing it, but say it may be stale
  const stale = error && <LoadError error={error} stale />
  if (!state.accounts.length)
    return (
      <>
        {stale}
        <FirstRun />
      </>
    )
  return (
    <RangeProvider>
      {stale}
      <DemoBanner />
      <Overview />
      <Stack gap="lg">
        {visible.map(({ id, component: Section }, i) => (
          <SectionNumber key={id} n={i + 1}>
            <Suspense fallback={<SectionSkeleton />}>
              <Section />
            </Suspense>
          </SectionNumber>
        ))}
      </Stack>
      <Text c="dimmed" fz="xs" ta="center" mt="xl">
        {t("外幣以記錄當天的中間價換算;沒更新的帳戶沿用上一筆的餘額和匯率。")}
      </Text>
    </RangeProvider>
  )
}

function Loading() {
  return (
    <Stack gap="lg" aria-busy="true" aria-label={t("載入中…")}>
      <Stack gap="sm" py={{ base: "lg", sm: "xl" }}>
        <Skeleton h={14} w={180} />
        <Skeleton h={72} w="70%" maw={520} />
        <Skeleton h={12} w="40%" />
      </Stack>
      {[260, 220, 180].map((h) => (
        <Card key={h}>
          <Skeleton h={22} w={200} mb="lg" />
          <Skeleton h={h} />
        </Card>
      ))}
    </Stack>
  )
}

function SectionSkeleton() {
  return (
    <Card aria-busy="true" aria-label={t("載入中…")}>
      <Skeleton h={22} w={200} mb="lg" />
      <Skeleton h={240} />
    </Card>
  )
}

function LoadError({ error, stale }: { error: Error; stale?: boolean }) {
  const { refresh } = useLedger()
  const [retrying, setRetrying] = useState(false)
  const retry = async () => {
    setRetrying(true)
    await refresh()
    setRetrying(false)
  }
  return (
    <Alert mt={stale ? "md" : "xl"} color="down" variant="light" icon={<CloudOff size={18} />} title={stale ? t("畫面上的資料可能不是最新的") : t("讀不到資料")}>
      <Text fz="sm" mb="md">
        {error.message}
      </Text>
      <Button color="down" variant="outline" size="xs" leftSection={<RotateCw size={14} />} loading={retrying} onClick={retry}>
        {t("再試一次")}
      </Button>
    </Alert>
  )
}
