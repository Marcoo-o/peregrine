import type { SqlDb } from '../db/sqlDb'
import { simpleParser } from 'mailparser'
import {
  indexMessageBody,
  listMessagesNeedingBody,
  markBodyIndexFailed,
  type BodyIndexCandidate
} from '../db/repositories/messagesRepo'
import type { ImapSession } from '@peregrine/core/imapSession'
import { asBuffer } from '../util/buffer'

/**
 * Fills the full-text index with message bodies.
 *
 * Envelope sync only stores headers, so without this the body search would only ever find
 * mail the user had already opened. The bodies are fetched in small batches after each
 * background sync round, one message at a time on the worker connection. A mailbox with a
 * few thousand unread messages must not turn into one long blocking download.
 */

/** Messages per round. Small enough that a round stays well clear of the next sync interval. */
const BATCH_SIZE = 20

/**
 * Messages above this size are left to be indexed when they are opened. Their bulk is
 * attachments, which the index has no use for, and IMAP offers no way to ask for just the
 * text part without knowing the MIME structure first.
 */
const MAX_INDEX_SIZE_BYTES = 1_000_000

const PREVIEW_LENGTH = 200

export function previewFromText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_LENGTH)
}

// The structural entities plus the accented letters that turn up in German and neighbouring
// languages. A mail written as "M&uuml;ller" has to be findable by searching for "Müller".
// Case matters: &Auml; and &auml; are different letters.
const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  ccedil: 'ç',
  ntilde: 'ñ',
  Eacute: 'É',
  euro: '€'
}

/**
 * Reduces an HTML body to the words in it, for messages that carry no text/plain part.
 *
 * This is for the index only, never for display. The rendering path sanitises and shows the
 * real HTML. So it does not need to preserve structure, only to avoid feeding tag names and
 * stylesheets to the search index as if they were content.
 */
export function textFromHtml(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (match, name: string) => HTML_ENTITIES[name] ?? match)
    .replace(/\s+/g, ' ')
    .trim()
}

async function indexOne(
  db: SqlDb,
  imap: ImapSession,
  candidate: BodyIndexCandidate
): Promise<boolean> {
  const raw = await imap.fetchFullMessage(candidate.imapPath, candidate.uid)
  if (!raw?.source) {
    // Gone from the server, or the server refused it. Either way, do not come back to it.
    await markBodyIndexFailed(db, candidate.id)
    return false
  }

  const parsed = await simpleParser(asBuffer(raw.source))
  // HTML-only mail has no text/plain part; without the fallback it would stay unsearchable.
  const text = parsed.text?.trim() || textFromHtml(parsed.html || '')
  await indexMessageBody(db, candidate.id, text, previewFromText(text))
  return true
}

/**
 * Indexes one batch and reports how many messages it got through.
 *
 * A message that fails is marked as attempted rather than retried: a body that cannot be
 * parsed will not parse on the next round either, and the batch always picks the same
 * newest-first rows, so one bad message would otherwise block every one behind it.
 */
export async function indexPendingBodies(
  db: SqlDb,
  accountId: string,
  imap: ImapSession,
  shouldStop: () => boolean = () => false
): Promise<number> {
  const candidates = await listMessagesNeedingBody(db, accountId, BATCH_SIZE)
  let indexed = 0

  for (const candidate of candidates) {
    if (shouldStop()) break
    if (candidate.sizeBytes > MAX_INDEX_SIZE_BYTES) {
      await markBodyIndexFailed(db, candidate.id)
      continue
    }
    try {
      if (await indexOne(db, imap, candidate)) indexed += 1
    } catch (err) {
      console.error(
        `indexing message ${candidate.uid} failed:`,
        err instanceof Error ? err.message : err
      )
      await markBodyIndexFailed(db, candidate.id)
    }
  }

  return indexed
}
