import { Chip, ColorSwatch, Group } from "@mantine/core"
import type { Kind } from "../../api/types"
import { t } from "../../i18n"

type Props = { kinds: Kind[]; value: string[]; onChange: (v: string[]) => void }

/** Multi-select kind filter that doubles as the chart legend (swatch + name). Empty value = 全部. */
export function KindChips({ kinds, value, onChange }: Props) {
  // Picking every kind is the same as 全部; keep the state canonical so 全部 lights up.
  const set = (v: string[]) => onChange(v.length === kinds.length ? [] : v)
  return (
    <Group gap={6} role="group" aria-label={t("篩選資產類別")}>
      <Chip size="xs" checked={!value.length} onChange={() => onChange([])}>
        {t("全部")}
      </Chip>
      <Chip.Group multiple value={value} onChange={set}>
        {kinds.map((k) => (
          <Chip key={k.key} value={k.key} size="xs" color={k.color}>
            <Group gap={6} wrap="nowrap" component="span">
              <ColorSwatch color={k.color} size={9} withShadow={false} aria-hidden />
              {t(k.name)}
            </Group>
          </Chip>
        ))}
      </Chip.Group>
    </Group>
  )
}
