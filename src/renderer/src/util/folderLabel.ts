import type { TFunction } from 'i18next'
import type { AccountSummary, FolderNode } from '@peregrine/core/types'
import { UNIFIED_SPECIAL_USES, type UnifiedSpecialUse } from '@renderer/state/mailboxStore'

/**
 * What an account is called in the sidebar, namely its address.
 *
 * It used to show `displayName`, which is the **sender name**, the one that ends up in the
 * From header. That name is the same across all accounts, and rightly so, because it is the
 * same person. But in a sidebar with twelve mailboxes it left nine visibly identical rows
 * underneath each other, and the distinguishing part, the address, appeared nowhere.
 *
 * The address is what makes a mailbox, it is unique, and it does not change when another
 * account is added.
 */
export function accountLabel(account: AccountSummary): string {
  return account.emailAddress || account.displayName
}

/** The sender name as a tooltip. Not worthless, just not a distinguishing mark. */
export function accountTitle(account: AccountSummary): string | undefined {
  if (!account.displayName || account.displayName === account.emailAddress) return undefined
  return `${account.displayName} <${account.emailAddress}>`
}

/**
 * Servers name their special folders in whatever language (or none): "INBOX", "Gesendet",
 * "Sent Items". Showing the translated label for a known special use keeps the tree readable
 * and consistent across accounts; everything else keeps the server's own name.
 */
export function folderLabel(folder: FolderNode, t: TFunction): string {
  const specialUse = folder.specialUse as UnifiedSpecialUse | null
  if (specialUse && UNIFIED_SPECIAL_USES.includes(specialUse)) {
    return t(`mailbox.specialUse.${specialUse}`)
  }
  return folder.displayName
}
