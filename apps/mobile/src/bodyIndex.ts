import type { ImapSession } from '@peregrine/core/imapSession'
import type { SqlDb } from '@peregrine/core/sqlDb'
import { describeError } from './errors'
import type { Folder } from './folders'
import { readMessage } from './messageText'

/** How much of a text is kept for the search. A message that is longer than this is searched in its first part. */
export const MAX_BODY_CHARS = 20_000

/** How long the line under a subject is, which the screen shortens further to what fits. */
export const PREVIEW_CHARS = 160

/**
 * The size above which a message is not fetched just to show a line of it. The whole of a message is fetched, with its
 * attachments, and a list that fetches twenty-five of them over mobile data must not cost what a few large files do.
 * Such a message gets its line, and its place in the search, when it is opened, which fetches it anyway.
 */
export const MAX_INDEXED_BYTES = 512 * 1024

/**
 * How many texts are fetched in one go. Each is a trip to the server, so a folder that has not been looked at is
 * worked through a few at a time, newest first, which is the order it is read in.
 */
export const INDEX_BATCH = 25

/**
 * The first of a text, as the line under a subject: what is quoted from an earlier message is left out, since it is
 * not what this one says, and the rest is flattened to one line of spaces.
 */
export function previewOf(text: string): string {
  const own = text
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('>'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return own.length > PREVIEW_CHARS ? `${own.slice(0, PREVIEW_CHARS - 1).trimEnd()}…` : own
}

/** The part of a text that is kept for the search, with the same line ends whatever the sender used. */
export const searchableOf = (text: string): string => text.replace(/\r\n/g, '\n').trim().slice(0, MAX_BODY_CHARS)

/** Keeps the text of a message, and the line of it that the list shows. An empty text is a text: it is not fetched again. */
export async function storeBody(db: SqlDb, folderId: string, uid: number, text: string): Promise<void> {
  await db.run(
    'UPDATE messages SET body_text = ?, preview_text = ? WHERE folder_id = ? AND uid = ?',
    searchableOf(text),
    previewOf(text),
    folderId,
    uid
  )
}

/** The newest messages of a folder whose text has not been fetched, with how large each is. */
async function withoutText(db: SqlDb, folderId: string, limit: number): Promise<Array<{ uid: number; size: number }>> {
  return db.all<{ uid: number; size: number }>(
    'SELECT uid, size FROM messages WHERE folder_id = ? AND body_text IS NULL ORDER BY uid DESC LIMIT ?',
    folderId,
    limit
  )
}

/**
 * Fetches the text of the next messages of a folder that have none stored, and stores it. Returns how many were done.
 *
 * A message the server no longer has, one that cannot be read and one that is too large to fetch for this are stored
 * with no text, so that they are not
 * tried again at every visit. A connection that fails is not that: it stops the run, is logged, and what was done
 * before it stays done, and the same messages are the next ones the next time.
 */
export async function indexBodies(
  session: ImapSession,
  db: SqlDb,
  folder: Pick<Folder, 'id' | 'imapPath'>,
  log: { error(message: string): void },
  limit: number = INDEX_BATCH
): Promise<number> {
  let done = 0
  for (const { uid, size } of await withoutText(db, folder.id, limit)) {
    if (size > MAX_INDEXED_BYTES) {
      // Nothing is fetched for it, and it is not asked about again: opening it keeps its text.
      await storeBody(db, folder.id, uid, '')
      done++
      continue
    }
    let full: Awaited<ReturnType<ImapSession['fetchFullMessage']>>
    try {
      full = await session.fetchFullMessage(folder.imapPath, uid)
    } catch (error) {
      log.error(`fetching the texts of ${folder.imapPath} stopped: ${describeError(error)}`)
      return done
    }
    let text = ''
    if (full) {
      try {
        text = readMessage(full.source).text
      } catch (error) {
        log.error(`the text of a message could not be read: ${describeError(error)}`)
      }
    }
    await storeBody(db, folder.id, uid, text)
    done++
  }
  return done
}

/**
 * Does the fetching of texts for a folder without anybody waiting for it, one run at a time for each folder: a list that
 * is brought up to date twice in a row does not fetch the same messages twice.
 */
export class BodyIndexer {
  private readonly running = new Set<string>()

  constructor(
    private readonly db: SqlDb,
    private readonly log: { error(message: string): void }
  ) {}

  /** Resolves with how many texts were stored, which is none when a run for the folder is going. */
  async run(session: ImapSession, folder: Pick<Folder, 'id' | 'imapPath'>, limit: number = INDEX_BATCH): Promise<number> {
    if (this.running.has(folder.id)) return 0
    this.running.add(folder.id)
    try {
      return await indexBodies(session, this.db, folder, this.log, limit)
    } catch (error) {
      // What the run could not be sure of is the database, which has no reason to fail and is not for the list to wait on.
      this.log.error(`storing the texts of ${folder.imapPath} failed: ${describeError(error)}`)
      return 0
    } finally {
      this.running.delete(folder.id)
    }
  }
}
