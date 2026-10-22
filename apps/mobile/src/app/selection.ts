/**
 * Several messages chosen in a list, to have one thing done to all of them.
 *
 * A message is known by the folder it is in and its UID, as the queue knows it. In the unified list the chosen
 * ones can be in folders of different accounts, so what is chosen is grouped by folder before anything is done.
 */

/** A message in a list, by where it is. */
export interface Picked {
  accountId: string
  folderId: string
  uid: number
}

export const keyOf = (message: Picked): string => `${message.folderId}:${message.uid}`

/** The set with the key in it, or without it when it was in it. The set that was given is not changed. */
export function toggled(keys: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(keys)
  if (!next.delete(key)) next.add(key)
  return next
}

/** Those of the messages that are shown which were chosen. What was chosen and is gone from the list is not. */
export function pickedIn<T extends Picked>(shown: readonly T[], keys: ReadonlySet<string>): T[] {
  return shown.filter((message) => keys.has(keyOf(message)))
}

/** The UIDs chosen in one folder. */
export interface FolderGroup {
  folderId: string
  accountId: string
  uids: number[]
}

/** What is chosen, as one group for each folder, in the order the folders first came up. */
export function groupByFolder(picked: readonly Picked[]): FolderGroup[] {
  const groups = new Map<string, FolderGroup>()
  for (const message of picked) {
    const group = groups.get(message.folderId) ?? { folderId: message.folderId, accountId: message.accountId, uids: [] }
    group.uids.push(message.uid)
    groups.set(message.folderId, group)
  }
  return [...groups.values()]
}
