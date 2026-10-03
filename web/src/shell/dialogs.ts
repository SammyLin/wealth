import { createContext, useContext } from "react"

// Lets any component open the app-level dialogs App owns: useOpenDialog()("record").
// open("accounts", id) opens the accounts dialog on that account.
export type DialogName = "record" | "settings" | "accounts"
export type Dialog = { name: DialogName; accountId?: number }
export const DialogContext = createContext<(d: DialogName, accountId?: number) => void>(() => {})
export const useOpenDialog = () => useContext(DialogContext)
