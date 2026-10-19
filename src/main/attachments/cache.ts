import { app } from 'electron'
import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Opening a message writes its attachments to disk so they can be handed to the OS. Nothing
 * ever needed them again afterwards, so the directory grew without bound. Entries are kept for
 * a while (re-opening a recent mail should be instant) and pruned on startup.
 */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

function attachmentsRoot(): string {
  return join(app.getPath('userData'), 'attachments')
}

async function directorySize(path: string): Promise<number> {
  let total = 0
  let entries: string[]
  try {
    entries = await readdir(path)
  } catch {
    return 0
  }
  for (const entry of entries) {
    const full = join(path, entry)
    try {
      const info = await stat(full)
      total += info.isDirectory() ? await directorySize(full) : info.size
    } catch {
      // Raced with a delete, or unreadable. It simply does not count.
    }
  }
  return total
}

export async function attachmentCacheSize(): Promise<number> {
  return directorySize(attachmentsRoot())
}

export async function clearAttachmentCache(): Promise<void> {
  await rm(attachmentsRoot(), { recursive: true, force: true })
}

/** Drops per-message attachment directories that have not been touched in a month. */
export async function pruneAttachmentCache(): Promise<{ removed: number }> {
  const root = attachmentsRoot()
  const cutoff = Date.now() - MAX_AGE_MS
  let removed = 0

  let accounts: string[]
  try {
    accounts = await readdir(root)
  } catch {
    return { removed: 0 }
  }

  for (const account of accounts) {
    const accountDir = join(root, account)
    let messages: string[]
    try {
      messages = await readdir(accountDir)
    } catch {
      continue
    }
    for (const message of messages) {
      const messageDir = join(accountDir, message)
      try {
        const info = await stat(messageDir)
        if (info.mtimeMs < cutoff) {
          await rm(messageDir, { recursive: true, force: true })
          removed += 1
        }
      } catch {
        // Unreadable entry; leave it alone rather than risking a wrong delete.
      }
    }
  }
  return { removed }
}
