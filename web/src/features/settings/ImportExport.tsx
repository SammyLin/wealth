import type { ReactNode } from "react"
import { Button, Group, Paper, Stack, Text, ThemeIcon } from "@mantine/core"
import { ArrowDownToLine, Clock, Database, ListOrdered, Sheet } from "lucide-react"
import { BACKUP_DB_URL, EXPORT_LONG_URL, exportCsvUrl } from "../../api/client"
import { useLedgerState } from "../../api/useLedger"
import { t, useLang } from "../../i18n"
import { CsvImport } from "./CsvImport"

/** Export CSV, download the .db (self-hosted only), import balances from CSV. */
export function ImportExport() {
  const { state } = useLedgerState()
  const { lang } = useLang()
  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Download
          icon={<Sheet size={18} />}
          title={t("試算表 CSV")}
          description={t("帳戶一列、日期一欄,附各類小計與淨資產。Excel、Numbers 直接開。")}
          href={exportCsvUrl(lang === "en")}
        />
        <Download
          icon={<ListOrdered size={18} />}
          title={t("餘額明細 CSV")}
          description={t("每筆餘額一列(date,account,amount,fx),跟匯入的格式相同,可以直接匯回來。")}
          href={EXPORT_LONG_URL}
        />
        {state.file_backups && (
          <Download
            icon={<Database size={18} />}
            title={t("完整備份 .db")}
            description={t("包含帳戶、每筆餘額、匯率、大事、貸款。要還原時把它換成 wealth.db。")}
            href={BACKUP_DB_URL}
          />
        )}
        <Group gap={6} wrap="nowrap" align="flex-start">
          <Clock size={14} aria-hidden style={{ flexShrink: 0, marginTop: 3 }} color="var(--mantine-color-dimmed)" />
          <Text c="dimmed" fz="xs">
            {state.file_backups
              ? t("伺服器每天自動備份一份到 backups/,保留最近 30 天。")
              : t("資料存在 Cloudflare D1,內建 30 天內任一時間點還原(Time Travel)。")}
          </Text>
        </Group>
      </Stack>
      <CsvImport />
    </Stack>
  )
}

function Download({ icon, title, description, href }: { icon: ReactNode; title: string; description: string; href: string }) {
  return (
    <Paper withBorder p="sm" radius="md">
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <ThemeIcon variant="light" size="lg" radius="md" aria-hidden>
          {icon}
        </ThemeIcon>
        <Stack gap={2} flex={1} miw={0}>
          <Text fw={600} fz="sm">
            {title}
          </Text>
          <Text c="dimmed" fz="xs">
            {description}
          </Text>
        </Stack>
        <Button component="a" href={href} download variant="default" size="compact-sm" leftSection={<ArrowDownToLine size={14} />} aria-label={`${t("下載")} ${title}`}>
          {t("下載")}
        </Button>
      </Group>
    </Paper>
  )
}
