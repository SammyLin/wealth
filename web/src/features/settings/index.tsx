import type { ReactNode } from "react"
import { Box, Divider, Drawer, Modal, Stack, Text, Title, useMatches } from "@mantine/core"
import { t } from "../../i18n"
import { DirtyContext, useGuardedClose } from "../../shell/dirty"
import { CsvImport } from "./CsvImport"
import { LedgerSettings } from "./LedgerSettings"
import { DisplaySettings } from "./DisplaySettings"
import { LayoutEditor } from "./LayoutEditor"
import { ImportExport } from "./ImportExport"

// Rendered by App only after /api/state has loaded. The drawer unmounts its content when closed,
// so every open starts from the current settings. Closing over an unsaved ledger name asks first.
export function SettingsDrawer({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const size = useMatches({ base: "100%", sm: "md" })
  const { dirty, close } = useGuardedClose(onClose)
  return (
    <Drawer opened={opened} onClose={close} title={t("設定")} size={size}>
      <DirtyContext.Provider value={dirty}>
        <Stack gap="xl" pb="xl">
          <Block title={t("帳本")} description={t("帳本叫什麼、用哪個幣別當基準。")}>
            <LedgerSettings />
          </Block>
          <Divider />
          <Block title={t("顯示")}>
            <DisplaySettings />
          </Block>
          <Divider />
          <Block title={t("首頁區塊")} description={t("調整順序或隱藏;最上方的淨資產總覽固定顯示。")}>
            <LayoutEditor />
          </Block>
          <Divider />
          <Block title={t("匯入與匯出")}>
            <ImportExport />
          </Block>
        </Stack>
      </DirtyContext.Provider>
    </Drawer>
  )
}

/** CSV import on its own, for the first-run screen (a migrating household starts from a spreadsheet). */
export function ImportDialog({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const fullScreen = useMatches({ base: true, sm: false })
  return (
    <Modal opened={opened} onClose={onClose} title={t("從 CSV 匯入")} size="lg" fullScreen={fullScreen}>
      <CsvImport />
    </Modal>
  )
}

function Block({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Box component="section">
      <Title order={3} fz="md" lts=".02em">
        {title}
      </Title>
      {description && (
        <Text c="dimmed" fz="sm" mt={2}>
          {description}
        </Text>
      )}
      <Box mt="md">{children}</Box>
    </Box>
  )
}

export default SettingsDrawer
