import type { Folder } from '../folders'
import { isInbox, type UnifiedRole } from '../unified'
import type { IconName } from './Icon'

/** The picture of each role a server can name for a folder, as the desktop draws them. */
const ROLE_ICONS: Record<string, IconName> = {
  '\\Inbox': 'inbox',
  '\\Drafts': 'drafts',
  '\\Sent': 'sent',
  '\\Archive': 'archive',
  '\\Junk': 'junk',
  '\\Trash': 'trash',
  '\\Flagged': 'star'
}

/** The picture of a folder: that of its role, the inbox's for the one called INBOX, and a folder's for the rest. */
export function folderIconName(folder: Pick<Folder, 'specialUse' | 'imapPath'>): IconName {
  if (folder.specialUse && ROLE_ICONS[folder.specialUse]) return ROLE_ICONS[folder.specialUse]
  return isInbox(folder) ? 'inbox' : 'folder'
}

/** The picture of a role of all accounts, which is that of the folders that have it. */
export const roleIconName = (role: UnifiedRole): IconName => role
