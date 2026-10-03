import { Badge, ColorSwatch, Group, NavLink, Stack, Text } from "@mantine/core"
import { ArrowDownRight, ArrowUpRight } from "lucide-react"
import type { Account, Kind } from "../../api/types"
import { useMoney } from "../../api/useLedger"
import { t } from "../../i18n"
import { fmtDate, fmtFx } from "../../lib/format"
import { valueOf } from "./sheet"

/**
 * Kind chip: the name in ink on paper-2 next to a color dot, so the label stays readable whatever color the
 * user picked, and color is never the only signal.
 */
export function KindBadge({ kind }: { kind: Kind | undefined }) {
  if (!kind) return null
  return (
    <Group component="span" gap={4} wrap="nowrap" px={6} py={1} bg="var(--wealth-paper-2)" style={{ borderRadius: 4, flexShrink: 0 }}>
      <ColorSwatch color={kind.color} size={8} withShadow={false} aria-hidden />
      <Text span fz={12} lh={1.4} c="var(--mantine-color-text)">
        {t(kind.name)}
      </Text>
    </Group>
  )
}

type Props = { account: Account; kind: Kind | undefined; base: string; liability: boolean; onEdit: (id: number) => void }

export function AccountRow({ account: a, kind, base, liability, onEdit }: Props) {
  const money = useMoney()
  const last = a.history.at(-1)
  const prev = a.history.at(-2)
  const value = valueOf(a)
  const delta = prev ? value - prev.value : 0
  // a liability shrinking is good news
  const good = liability ? delta < 0 : delta > 0
  const when = last ? fmtDate(last.date) : t("尚未記錄")
  // no rate before the first record (the server's fx 1 is a placeholder, not a rate)
  const sub = a.currency === base ? when : last ? `${money(a.amount)} ${a.currency} × ${fmtFx(a.fx)} · ${when}` : `${a.currency} · ${when}`

  return (
    <NavLink
      component="button"
      type="button"
      onClick={() => onEdit(a.id)}
      title={t("編輯、看歷史紀錄")}
      px={4}
      py={8}
      style={{ borderTop: "1px solid var(--wealth-rule)", borderRadius: 0 }}
      label={
        <Group gap={6} wrap="nowrap" miw={0}>
          <Text fz="sm" truncate>
            {a.name}
          </Text>
          <KindBadge kind={kind} />
          {a.archived && (
            <Badge size="sm" radius="sm" variant="outline" color="gray" tt="none" fw={500} style={{ flexShrink: 0 }}>
              {t("已封存")}
            </Badge>
          )}
        </Group>
      }
      description={
        <Text component="span" fz="xs" c="dimmed" className="num" truncate display="block">
          {sub}
        </Text>
      }
      rightSection={
        <Stack gap={0} align="flex-end">
          <Text className="num" fz="sm" fw={500}>
            {money(value)}
          </Text>
          {delta !== 0 && (
            <Group gap={2} wrap="nowrap" c={good ? "var(--wealth-up)" : "var(--wealth-down)"} title={t("較上次紀錄")}>
              {delta > 0 ? <ArrowUpRight size={12} aria-hidden /> : <ArrowDownRight size={12} aria-hidden />}
              <Text className="num" fz="xs" c="inherit">
                {money(delta, { signed: true })}
              </Text>
            </Group>
          )}
        </Stack>
      }
    />
  )
}
