import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { MantineProvider } from "@mantine/core"
import { ModalsProvider } from "@mantine/modals"
import { Notifications } from "@mantine/notifications"
import "./index.css"
import { useLang } from "./i18n"
import { cssVariablesResolver, themeFor } from "./theme"
import App from "./App"

// The root subscribes to the language: switching re-renders the whole tree (t() reads module state) and
// swaps in that language's cached theme, whose default aria-labels are translated.
// oxlint-disable-next-line react/only-export-components -- entry file, never hot-reloaded on its own
function Root() {
  const { lang } = useLang()
  return (
    <MantineProvider theme={themeFor(lang)} cssVariablesResolver={cssVariablesResolver} defaultColorScheme="auto">
      <ModalsProvider>
        <Notifications />
        <App />
      </ModalsProvider>
    </MantineProvider>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
