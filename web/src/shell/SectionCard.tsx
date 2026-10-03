import { createContext, useContext, useId, type ReactNode } from "react"
import { Box, Card, Group, Text, Title } from "@mantine/core"

const SectionIndex = createContext(0)

/** App wraps each dashboard section in this so its SectionCard shows "01", "02"… in layout order. */
export function SectionNumber({ n, children }: { n: number; children: ReactNode }) {
  return <SectionIndex.Provider value={n}>{children}</SectionIndex.Provider>
}

type Props = {
  title: ReactNode
  description?: ReactNode
  /** Right-aligned controls (filters, add button); wraps under the title on phones. */
  actions?: ReactNode
  children?: ReactNode
}

/** A numbered dashboard section. Use as the root of every section component. */
export function SectionCard({ title, description, actions, children }: Props) {
  const n = useContext(SectionIndex)
  const id = useId()
  return (
    <Card component="section" aria-labelledby={id}>
      <Group justify="space-between" align="flex-end" gap="sm" mb="lg">
        <Box miw={0}>
          <Group gap="sm" align="baseline" wrap="nowrap">
            {n > 0 && (
              <Text className="num" span fs="italic" c="gold" fz="lg" aria-hidden>
                {String(n).padStart(2, "0")}
              </Text>
            )}
            <Title order={2} id={id} fz={{ base: "1.3rem", sm: "1.6rem" }} lts=".02em" lh={1.2}>
              {title}
            </Title>
          </Group>
          {description && (
            <Text c="dimmed" fz="sm" mt={4}>
              {description}
            </Text>
          )}
        </Box>
        {actions && <Group gap="xs">{actions}</Group>}
      </Group>
      {children}
    </Card>
  )
}
