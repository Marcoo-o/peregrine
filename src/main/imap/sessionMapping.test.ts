import type { FetchMessageObject, ListResponse } from 'imapflow'
import { describe, expect, it } from 'vitest'
import { toFetchedMessage, toMailboxEntry } from './ImapConnection'

/**
 * Where imapflow's objects become ours. The sync engine used to read them directly, so what it
 * relied on is written down here, as the behaviour a second implementation has to match.
 */

function box(overrides: Partial<ListResponse> = {}): ListResponse {
  return {
    path: 'INBOX',
    pathAsListed: 'INBOX',
    name: 'INBOX',
    delimiter: '/',
    parent: [],
    parentPath: '',
    flags: new Set(['\\HasNoChildren']),
    listed: true,
    subscribed: true,
    ...overrides
  } as ListResponse
}

function message(overrides: Partial<FetchMessageObject> = {}): FetchMessageObject {
  return { seq: 1, uid: 7, flags: new Set(['\\Seen']), size: 1200, ...overrides } as FetchMessageObject
}

describe('toMailboxEntry', () => {
  it('turns the attribute set into a list and leaves the path alone', () => {
    expect(toMailboxEntry(box({ path: 'Archiv.2026', name: '2026', parentPath: 'Archiv' }))).toEqual({
      path: 'Archiv.2026',
      name: '2026',
      parentPath: 'Archiv',
      flags: ['\\HasNoChildren'],
      specialUse: null
    })
  })

  // The sync engine tests for a parent with a truthiness check. The empty string imapflow uses
  // for "none" has to stay indistinguishable from null.
  it('reports a top level folder as having no parent', () => {
    expect(toMailboxEntry(box({ parentPath: '' })).parentPath).toBeNull()
  })

  it('carries the role the server names', () => {
    expect(toMailboxEntry(box({ specialUse: '\\Sent' })).specialUse).toBe('\\Sent')
  })
})

describe('toFetchedMessage', () => {
  it('copies what a folder sync reads', () => {
    const fetched = toFetchedMessage(
      message({
        envelope: {
          subject: 'Hello',
          messageId: '<a@b>',
          inReplyTo: '<c@d>',
          date: new Date('2026-01-02T03:04:05Z'),
          from: [{ name: 'A', address: 'a@example.com' }],
          to: [{ address: 'b@example.com' }]
        }
      })
    )

    expect(fetched).toMatchObject({
      uid: 7,
      flags: ['\\Seen'],
      size: 1200,
      envelope: {
        subject: 'Hello',
        messageId: '<a@b>',
        inReplyTo: '<c@d>',
        from: [{ name: 'A', address: 'a@example.com' }],
        to: [{ name: undefined, address: 'b@example.com' }]
      }
    })
    expect(fetched?.envelope.date?.toISOString()).toBe('2026-01-02T03:04:05.000Z')
  })

  // imapflow passes the raw text of a Date header on when it cannot read it, and the sync engine
  // calls toISOString on whatever it gets. One such message used to fail the sync of its folder.
  it('turns a date that cannot be read into no date', () => {
    const withDate = (date: unknown) =>
      toFetchedMessage(message({ envelope: { date } as never }))?.envelope.date
    expect(withDate('Tue, 32 Foo 2026 25:61:00 +0000')).toBeUndefined()
    expect(withDate(new Date('nonsense'))).toBeUndefined()
    expect(withDate(undefined)).toBeUndefined()
    expect(withDate('Mon, 05 Jan 2026 10:00:00 +0000')?.toISOString()).toBe('2026-01-05T10:00:00.000Z')
  })

  // The old code skipped these in the loop that wrote them. Nothing can point at a message
  // without a UID later, so it never reaches the caller at all.
  it('drops a message the server sent without a UID', () => {
    expect(toFetchedMessage(message({ uid: undefined }))).toBeNull()
  })

  it('copes with a message that carries no envelope, no flags and no size', () => {
    const fetched = toFetchedMessage({ seq: 1, uid: 3 } as FetchMessageObject)

    expect(fetched).toEqual({
      uid: 3,
      flags: [],
      size: 0,
      envelope: {
        subject: undefined,
        messageId: undefined,
        inReplyTo: undefined,
        date: undefined,
        from: undefined,
        to: undefined,
        cc: undefined,
        bcc: undefined
      },
      hasAttachment: false
    })
  })

  describe('hasAttachment', () => {
    const part = (disposition?: string, childNodes?: unknown[]) => ({ disposition, childNodes })

    it('is true when a direct part is marked as an attachment', () => {
      const fetched = toFetchedMessage(
        message({
          bodyStructure: part(undefined, [part('inline'), part('attachment')]) as never
        })
      )
      expect(fetched?.hasAttachment).toBe(true)
    })

    it('is false for a message of text parts only', () => {
      const fetched = toFetchedMessage(
        message({ bodyStructure: part(undefined, [part(), part('inline')]) as never })
      )
      expect(fetched?.hasAttachment).toBe(false)
    })

    // Only the first level was ever looked at. This pins that down, so that a better answer is
    // a decision and not an accident of a rewrite.
    it('does not look inside nested parts', () => {
      const fetched = toFetchedMessage(
        message({
          bodyStructure: part(undefined, [part(undefined, [part('attachment')])]) as never
        })
      )
      expect(fetched?.hasAttachment).toBe(false)
    })
  })
})
