import { Modal, Skeleton, Tabs } from "@mantine/core"
import { useMediaQuery } from "@mantine/hooks"
import { Shapes, WalletCards } from "lucide-react"
import { useLedger } from "../../api/useLedger"
import { t } from "../../i18n"
import { AccountList } from "./AccountList"
import { KindsManager } from "./KindsManager"

/** "帳戶與類別" dialog: accounts (edit, reorder, archive, history) and account classes. Full screen on phones. */
type Props = { opened: boolean; onClose: () => void; /** Opens with this account expanded. */ accountId?: number }

export function AccountsManager({ opened, onClose, accountId }: Props) {
  const { state } = useLedger()
  const phone = useMediaQuery("(max-width: 48em)") // Mantine `sm`
  return (
    <Modal opened={opened} onClose={onClose} title={t("帳戶與類別")} size="xl" fullScreen={phone}>
      <Tabs defaultValue="accounts" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="accounts" leftSection={<WalletCards size={16} />}>
            {t("所有帳戶")}
          </Tabs.Tab>
          <Tabs.Tab value="kinds" leftSection={<Shapes size={16} />}>
            {t("帳戶類別")}
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="accounts">{state ? <AccountList initialOpen={accountId} /> : <Skeleton h={240} />}</Tabs.Panel>
        <Tabs.Panel value="kinds">
          <KindsManager />
        </Tabs.Panel>
      </Tabs>
    </Modal>
  )
}

export default AccountsManager
