import { createContext, useContext } from "react"

// Lets any component open the app-level dialogs App owns: useOpenDialog()("record").
// open("accounts", id) opens the accounts dialog on that account; open("accounts", "new") on the add form.
type DialogName = "record" | "settings" | "accounts" | "import"
export type AccountTarget = number | "new"
export type Dialog = { name: DialogName; accountId?: AccountTarget }
export const DialogContext = createContext<(d: DialogName, accountId?: AccountTarget) => void>(() => {})
export const useOpenDialog = () => useContext(DialogContext)
