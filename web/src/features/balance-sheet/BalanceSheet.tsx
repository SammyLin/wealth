import { useId, useState, type ReactNode } from "react"
import { Box, Button, Collapse, Divider, EmptyState, Flex, Group, Stack, Text, Title, UnstyledButton } from "@mantine/core"
import { useLocalStorage } from "@mantine/hooks"
import { Archive, ArchiveRestore, ChevronRight, Plus, WalletCards } from "lucide-react"
import { useLedgerState, useMoney } from "../../api/useLedger"
import { T, t } from "../../i18n"
import { fmtPct } from "../../lib/format"
import { useOpenDialog } from "../../shell/dialogs"
import { SectionCard } from "../../shell/SectionCard"
import { AccountRow } from "./AccountRow"
import { buildSheet, type Group as SheetGroup } from "./sheet"

export function BalanceSheet() {
  const { state } = useLedgerState()
  const money = useMoney()
  const open = useOpenDialog()
  const [showArchived, setShowArchived] = useState(false)
  const [collapsed, setCollapsed] = useLocalStorage<string[]>({ key: "wealth.sheet.collapsed", defaultValue: [] })

  const base = state.settings.base_currency
  const sheet = buildSheet(state.accounts, state.kinds, showArchived)
  const kindOf = new Map(state.kinds.map((k) => [k.key, k]))
  const edit = (id: number) => open("accounts", id)
  const toggle = (id: string) => setCollapsed((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))
  const tier = (g: SheetGroup, share?: number) => (
    <Tier key={g.id} group={g} share={share} open={!collapsed.includes(g.id)} onToggle={() => toggle(g.id)}>
      {g.accounts.map((a) => (
        <AccountRow key={a.id} account={a} kind={kindOf.get(a.kind)} base={base} liability={g.id === "liability"} onEdit={edit} />
      ))}
    </Tier>
  )
  const archivedToggle = (sheet.hiddenArchived > 0 || showArchived) && (
    <Button
      variant="subtle"
      color="gray"
      size="xs"
      leftSection={showArchived ? <Archive size={14} /> : <ArchiveRestore size={14} />}
      aria-pressed={showArchived}
      onClick={() => setShowArchived((v) => !v)}
    >
      {showArchived ? t("隱藏已封存") : T`顯示已封存(${sheet.hiddenArchived})`}
    </Button>
  )
  const actions = (
    <>
      {archivedToggle}
      <Button variant="default" size="xs" leftSection={<Plus size={14} />} onClick={() => open("accounts")}>
        {t("新增帳戶")}
      </Button>
    </>
  )
  const empty = !sheet.tiers.length && !sheet.liabilities.accounts.length

  return (
    <SectionCard title={t("資產負債表")} description={T`淨資產 = 資產合計 − 負債。金額以 ${base} 計,點帳戶可編輯。`} actions={actions}>
      {empty ? (
        <EmptyState
          variant="light"
          icon={<WalletCards size={24} />}
          title={t("沒有使用中的帳戶")}
          description={t("新增一個帳戶,或顯示已封存的帳戶。")}
        />
      ) : (
        <Flex direction={{ base: "column", md: "row" }} gap={{ base: "lg", md: "xl" }}>
          <Column
            title={t("資產")}
            meta={T`${sheet.tiers.reduce((n, g) => n + g.accounts.length, 0)} 個帳戶`}
            footer={<Total label={t("資產合計")} value={money(sheet.assets)} />}
          >
            {sheet.tiers.length ? (
              sheet.tiers.map((g) => tier(g, sheet.assets ? g.total / sheet.assets : 0))
            ) : (
              <Text c="dimmed" fz="sm" py="md">
                {t("還沒有資產帳戶。")}
              </Text>
            )}
          </Column>
          <Divider hiddenFrom="md" />
          <Divider orientation="vertical" visibleFrom="md" />
          <Column
            title={t("負債與淨資產")}
            meta={T`${sheet.liabilities.accounts.length} 筆負債`}
            footer={<Total label={t("負債與淨資產合計")} note={t("= 資產合計")} value={money(sheet.debt + sheet.net)} />}
          >
            {sheet.liabilities.accounts.length ? (
              tier(sheet.liabilities, sheet.assets ? sheet.debt / sheet.assets : undefined)
            ) : (
              <Text c="dimmed" fz="sm" py="md">
                {t("沒有負債。")}
              </Text>
            )}
            <Group justify="space-between" wrap="nowrap" py="sm" mt="xs" style={{ borderTop: "1px solid var(--wealth-rule)" }}>
              <Text fz="sm" fw={500} c={sheet.net < 0 ? "var(--wealth-down)" : "gold"}>
                {sheet.net < 0 ? t("淨資產(資不抵債)") : t("淨資產")}
              </Text>
              <Text className="num" fw={500} fz="lg" c={sheet.net < 0 ? "var(--wealth-down)" : undefined}>
                {money(sheet.net)}
              </Text>
            </Group>
          </Column>
        </Flex>
      )}
    </SectionCard>
  )
}

function Column({ title, meta, footer, children }: { title: string; meta: string; footer: ReactNode; children: ReactNode }) {
  return (
    <Stack gap={0} flex={1} miw={0}>
      <Group justify="space-between" align="baseline" pb={8} mb={4} style={{ borderBottom: "2px solid var(--mantine-color-text)" }}>
        <Title order={3} fz="md" lts=".06em">
          {title}
        </Title>
        <Text fz="xs" c="dimmed">
          {meta}
        </Text>
      </Group>
      {children}
      <Box mt="auto" pt="md">
        {footer}
      </Box>
    </Stack>
  )
}

function Total({ label, note, value }: { label: string; note?: string; value: string }) {
  return (
    <Group justify="space-between" align="flex-end" wrap="nowrap">
      <Box>
        <Text fz="sm" c="dimmed">
          {label}
        </Text>
        {note && (
          <Text fz="xs" c="dimmed">
            {note}
          </Text>
        )}
      </Box>
      <Text className="num" fz="xl" fw={500} pb={1} style={{ borderBottom: "3px double var(--mantine-color-text)" }}>
        {value}
      </Text>
    </Group>
  )
}

type TierProps = { group: SheetGroup; share?: number; open: boolean; onToggle: () => void; children: ReactNode }

function Tier({ group, share, open, onToggle, children }: TierProps) {
  const money = useMoney()
  const id = useId()
  return (
    <Box>
      <UnstyledButton w="100%" py={10} onClick={onToggle} aria-expanded={open} aria-controls={id}>
        <Group gap="xs" wrap="nowrap">
          <ChevronRight
            size={16}
            aria-hidden
            color="var(--mantine-color-dimmed)"
            style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform 150ms ease", flexShrink: 0 }}
          />
          <Text fz="sm" fw={500} flex={1} truncate>
            {t(group.label)}
          </Text>
          {share !== undefined && (
            <Text fz="xs" c="dimmed" className="num" title={group.id === "liability" ? t("負債比") : t("佔資產")}>
              {fmtPct(share, 0)}
            </Text>
          )}
          <Text className="num" fz="sm" fw={500}>
            {money(group.total)}
          </Text>
        </Group>
      </UnstyledButton>
      <Collapse expanded={open} id={id}>
        {children}
      </Collapse>
    </Box>
  )
}
