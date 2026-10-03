import { useMatches } from "@mantine/core"

/** Below Mantine's `sm` breakpoint (48em): big dialogs go full screen there. The one phone check in the app. */
export const useIsPhone = () => useMatches({ base: true, sm: false })
