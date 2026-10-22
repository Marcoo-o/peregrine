import type { Folder } from '../folders'
import type { UnifiedRole } from '../unified'

/** What servers name the folders that have a job, by the role they say they have, and what they are called here. */
const ROLE_LABELS: Record<string, string> = {
  '\\Inbox': 'Posteingang',
  '\\Sent': 'Gesendet',
  '\\Drafts': 'Entwürfe',
  '\\Trash': 'Papierkorb',
  '\\Junk': 'Spam',
  '\\Archive': 'Archiv',
  '\\Flagged': 'Markiert',
  '\\All': 'Alle Nachrichten'
}

/**
 * What a folder is called on a screen. A server's own names are English, or whatever its maker thought of,
 * so a folder with a known job is named by it. The inbox has no role on many servers, only its name, which
 * is the one name the protocol fixes. Any other folder keeps the name it has.
 */
export function folderLabel(folder: Pick<Folder, 'imapPath' | 'displayName' | 'specialUse'>): string {
  if (folder.specialUse && ROLE_LABELS[folder.specialUse]) return ROLE_LABELS[folder.specialUse]
  if (folder.imapPath.toUpperCase() === 'INBOX') return ROLE_LABELS['\\Inbox']
  return folder.displayName
}

const ROLE_NAMES: Record<UnifiedRole, string> = {
  inbox: 'Posteingang',
  // What the desktop calls the folder of the messages that are put aside.
  snoozed: 'Wiedervorlage',
  drafts: 'Entwürfe',
  sent: 'Gesendet',
  archive: 'Archiv',
  junk: 'Spam',
  trash: 'Papierkorb'
}

/** What the folders of a role of all accounts are called, as the folder of one account with that role is. */
export const roleLabel = (role: UnifiedRole): string => ROLE_NAMES[role]
