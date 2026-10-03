import { Stack, Text } from "@mantine/core"

/** A small label over a figure: hero totals, loan cards, the loan dialog's preview. */
export function Stat({ label, value, align }: { label: string; value: string; align?: "right" }) {
  return (
    <Stack gap={0} ta={align} miw={0}>
      <Text fz="xs" c="dimmed" truncate>
        {label}
      </Text>
      <Text className="num" fz="lg" lh={1.3} style={{ whiteSpace: "nowrap" }}>
        {value}
      </Text>
    </Stack>
  )
}
