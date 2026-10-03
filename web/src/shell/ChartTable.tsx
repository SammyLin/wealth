import { useState } from "react"
import { Box, ScrollArea, Table, Text } from "@mantine/core"
import { t } from "../i18n"

type Props = { caption: string; head: string[]; rows: () => (string | number)[][] }

/**
 * A chart's numbers as a table, behind a "show as table" disclosure: tooltips need a mouse, so this is how
 * keyboard and screen-reader users read every point. `rows` runs only once it is opened (a 30-year payment
 * schedule is 360 rows). First column is a row header; the rest are right-aligned figures.
 */
export function ChartTable({ caption, head, rows }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <Box component="details" mt={4} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <Text component="summary" fz="xs" c="dimmed" w="fit-content" style={{ cursor: "pointer" }}>
        {t("以表格顯示")}
      </Text>
      {open && (
        <ScrollArea.Autosize mah={320} mt="xs" type="auto">
          <Table fz="xs" striped stickyHeader verticalSpacing={4} captionSide="top" miw={head.length * 96}>
            <Table.Caption>{caption}</Table.Caption>
            <Table.Thead>
              <Table.Tr>
                {head.map((h, i) => (
                  <Table.Th key={h} ta={i ? "right" : undefined}>
                    {h}
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows().map(([first, ...rest]) => (
                <Table.Tr key={String(first)}>
                  <Table.Th scope="row" fw={400} className="num">
                    {first}
                  </Table.Th>
                  {rest.map((v, i) => (
                    <Table.Td key={i} ta="right" className="num" style={{ whiteSpace: "nowrap" }}>
                      {v}
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea.Autosize>
      )}
    </Box>
  )
}
