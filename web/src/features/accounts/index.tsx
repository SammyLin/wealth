import { Modal, Tabs } from "@mantine/core"
import { useIsPhone } from "../../shell/useIsPhone"
import { Shapes, WalletCards } from "lucide-react"
import { t } from "../../i18n"
import type { AccountTarget } from "../../shell/dialogs"
import { DirtyContext, useGuardedClose } from "../../shell/dirty"
import { AccountList } from "./AccountList"
import { KindsManager } from "./KindsManager"

/**
 * "帳戶與類別" dialog: accounts (edit, reorder, archive, history) and account classes. Full screen on phones.
 * Closing over an unsaved account edit, history row or new class asks first.
 */
type Props = { opened: boolean; onClose: () => void; /** Opens with this account expanded, or "new" on the add form. */ accountId?: AccountTarget }

export function AccountsManager({ opened, onClose, accountId }: Props) {
  const phone = useIsPhone()
  const { dirty, close } = useGuardedClose(onClose)
  return (
    <Modal opened={opened} onClose={close} title={t("帳戶與類別")} size="xl" fullScreen={phone}>
      <DirtyContext.Provider value={dirty}>
        <Tabs defaultValue="accounts" keepMounted={false}>
          <Tabs.List mb="md">
            <Tabs.Tab value="accounts" leftSection={<WalletCards size={16} />}>
              {t("所有帳戶")}
            </Tabs.Tab>
            <Tabs.Tab value="kinds" leftSection={<Shapes size={16} />}>
              {t("帳戶類別")}
            </Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="accounts">
            <AccountList initialOpen={accountId} />
          </Tabs.Panel>
          <Tabs.Panel value="kinds">
            <KindsManager />
          </Tabs.Panel>
        </Tabs>
      </DirtyContext.Provider>
    </Modal>
  )
}

export default AccountsManager
