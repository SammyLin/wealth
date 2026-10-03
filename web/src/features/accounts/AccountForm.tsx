import { useState } from "react"
import { Button, Group, SimpleGrid, Switch, Text, TextInput, Textarea } from "@mantine/core"
import { useForm } from "@mantine/form"
import { modals } from "@mantine/modals"
import { notifications } from "@mantine/notifications"
import { Check, Trash2 } from "lucide-react"
import { useLedgerState, useMoney } from "../../api/useLedger"
import type { Account, AccountPatch } from "../../api/types"
import { T, t } from "../../i18n"
import { CurrencyInput, KindSelect } from "./inputs"

const MAX_NOTE = 200 // server maxNote
const ok = (message: string) => notifications.show({ message, icon: <Check size={16} /> })

/**
 * Add form when `account` is missing (it stays open and refocuses the name after each add, so ten accounts
 * are ten quick entries; onDone is the cancel button); otherwise edits it, with archive and delete.
 */
export function AccountForm({ account, onDone }: { account?: Account; onDone?: () => void }) {
  const { state, createAccount, updateAccount, deleteAccount } = useLedgerState()
  const money = useMoney()
  const [saving, setSaving] = useState(false)
  const locked = !!account?.history.length // fx history is per currency
  const form = useForm({
    initialValues: {
      name: account?.name ?? "",
      kind: account?.kind ?? state.kinds[0]?.key ?? "",
      currency: account?.currency ?? state.settings.base_currency,
      note: account?.note ?? "",
    },
    validate: {
      name: (v) => (v.trim() ? null : t("名稱不能空白")),
      kind: (v) => (v ? null : t("請選一個類別")),
      currency: (v) => (/^[A-Z]{3}$/.test(v) ? null : t("幣別要是三個英文字母")),
      note: (v) => (v.trim().length <= MAX_NOTE ? null : t("備註太長")),
    },
  })

  const submit = form.onSubmit(async (v) => {
    const name = v.name.trim(), note = v.note.trim()
    setSaving(true)
    try {
      if (!account) {
        const a = await createAccount({ name, kind: v.kind, currency: v.currency, note })
        ok(T`已新增「${a.name}」,到「記一筆」填第一筆餘額`)
        // keep the kind and currency: the next account is often the same sort
        form.setValues({ name: "", note: "" })
        form.resetDirty()
        form.getInputNode("name")?.focus()
        return
      }
      const patch: AccountPatch = {}
      if (name !== account.name) patch.name = name
      if (v.kind !== account.kind) patch.kind = v.kind
      if (!locked && v.currency !== account.currency) patch.currency = v.currency
      if (note !== account.note) patch.note = note
      const commit = async () => {
        if (Object.keys(patch).length) await updateAccount(account.id, patch)
        form.setValues({ name, note })
        form.resetDirty({ ...v, name, note })
        ok(T`已更新「${name}」`)
      }
      // Moving between an asset and a liability class flips the sign of the whole history (series() reads it
      // from the class), so it gets the same confirm as changing a class's liquidity in KindsManager.
      const liab = (key: string) => state.kinds.find((k) => k.key === key)?.liquidity === "liability"
      if (patch.kind && account.history.length && liab(patch.kind) !== liab(account.kind)) {
        const toLiability = liab(patch.kind)
        modals.openConfirmModal({
          title: toLiability ? T`把「${name}」改成負債?` : T`把「${name}」改成資產?`,
          children: (
            <Text fz="sm">
              {toLiability
                ? T`它的 ${account.history.length} 筆紀錄會改從淨資產扣掉,所有歷史的淨資產都會重算。`
                : T`它的 ${account.history.length} 筆紀錄會改算進資產,所有歷史的淨資產都會重算。`}
            </Text>
          ),
          labels: { confirm: t("確定修改"), cancel: t("取消") },
          onConfirm: () => void commit().catch(() => {}),
        })
        return
      }
      await commit()
    } catch {
      /* useLedger already showed the error */
    } finally {
      setSaving(false)
    }
  })

  const setArchived = (archived: boolean) => {
    if (!account) return
    const run = () =>
      updateAccount(account.id, { archived }).then(
        () => ok(archived ? T`已封存「${account.name}」` : T`已取消封存「${account.name}」`),
        () => {},
      )
    if (!archived) return void run()
    modals.openConfirmModal({
      title: T`封存「${account.name}」?`,
      children: (
        <Text fz="sm">
          {t("封存後會收進資產負債表下方的「已封存」,歷史紀錄仍保留在趨勢圖裡。")}
          {account.amount !== 0 && (
            <Text span display="block" mt="sm" fz="sm" c="var(--wealth-down)" fw={500}>
              {T`目前餘額還有 ${money(account.amount)} ${account.currency},封存後仍會算進淨資產。帳戶已結清的話,先記一筆 0 再封存。`}
            </Text>
          )}
        </Text>
      ),
      labels: { confirm: t("封存"), cancel: t("取消") },
      onConfirm: run,
    })
  }

  const remove = () => {
    if (!account) return
    modals.openConfirmModal({
      title: T`刪除「${account.name}」?`,
      children: (
        <Text fz="sm">
          {T`會一起刪掉它的 ${account.history.length} 筆餘額紀錄,淨資產和趨勢都會重算,無法復原。只是不想再看到的話,用「封存」就好。`}
        </Text>
      ),
      labels: { confirm: t("永久刪除"), cancel: t("取消") },
      confirmProps: { color: "red" },
      onConfirm: () =>
        deleteAccount(account.id).then(
          () => ok(T`已刪除「${account.name}」`),
          () => {},
        ),
    })
  }

  return (
    <form onSubmit={submit} noValidate>
      <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="sm" verticalSpacing="sm">
        <TextInput
          label={t("名稱")}
          placeholder={t("例如:玉山活存")}
          required
          maxLength={60}
          data-autofocus={!account || undefined}
          {...form.getInputProps("name")}
        />
        <KindSelect label={t("類別")} required {...form.getInputProps("kind")} />
        <CurrencyInput
          label={t("幣別")}
          required
          disabled={locked}
          description={locked ? t("已經有餘額紀錄,幣別不能改") : t("三個英文字母,例如 TWD、USD")}
          {...form.getInputProps("currency")}
        />
        <Textarea label={t("備註")} placeholder={t("帳號末四碼、用途…")} autosize minRows={1} maxRows={4} maxLength={MAX_NOTE} {...form.getInputProps("note")} />
      </SimpleGrid>

      <Group justify="space-between" mt="md" gap="sm">
        {account ? (
          <Group gap="md">
            <Switch label={t("封存")} checked={account.archived} onChange={(e) => setArchived(e.currentTarget.checked)} />
            <Button variant="subtle" color="red" size="compact-sm" leftSection={<Trash2 size={14} />} onClick={remove}>
              {t("刪除帳戶")}
            </Button>
          </Group>
        ) : (
          <Button variant="default" onClick={onDone}>
            {t("完成")}
          </Button>
        )}
        <Button type="submit" loading={saving} disabled={!!account && !form.isDirty()}>
          {account ? t("儲存") : t("新增")}
        </Button>
      </Group>
    </form>
  )
}
