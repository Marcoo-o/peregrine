import { describe, expect, it } from 'vitest'
import type { MessageSummary } from '@peregrine/core/types'
import { buildThreads, normalizeSubject, threadRows } from './threading'

let counter = 0

function message(overrides: Partial<MessageSummary> = {}): MessageSummary {
  counter += 1
  return {
    id: `m${counter}`,
    accountId: 'a1',
    folderId: 'f1',
    uid: counter,
    subject: 'Angebot',
    fromName: 'Andreas',
    fromAddress: 'andreas@example.org',
    to: [],
    messageIdHeader: `<${counter}@example.org>`,
    inReplyTo: null,
    referencesHeader: null,
    date: `2026-08-0${counter}T10:00:00.000Z`,
    isRead: true,
    isFlagged: false,
    hasAttachments: false,
    previewText: '',
    tagKeywords: [],
    sizeBytes: 100,
    snoozedUntil: null,
    pendingMoveTo: null,
    ...overrides
  }
}

describe('normalizeSubject', () => {
  it('strips reply and forward prefixes in both languages', () => {
    expect(normalizeSubject('Re: Angebot')).toBe('angebot')
    expect(normalizeSubject('AW: Angebot')).toBe('angebot')
    expect(normalizeSubject('Fwd: Angebot')).toBe('angebot')
    expect(normalizeSubject('WG: Angebot')).toBe('angebot')
  })

  it('strips repeated and numbered prefixes', () => {
    expect(normalizeSubject('Re: Re: Angebot')).toBe('angebot')
    expect(normalizeSubject('Re[2]: Angebot')).toBe('angebot')
  })

  it('leaves an unprefixed subject alone', () => {
    expect(normalizeSubject('Angebot für John')).toBe('angebot für john')
  })
})

describe('buildThreads', () => {
  it('groups a reply with the message it answers', () => {
    const root = message({ subject: 'Angebot' })
    const reply = message({ subject: 'Re: Angebot', inReplyTo: root.messageIdHeader })
    const threads = buildThreads([root, reply])

    expect(threads).toHaveLength(1)
    expect(threads[0].nodes.map((n) => n.message.id)).toEqual([root.id, reply.id])
    expect(threads[0].nodes[1].depth).toBe(1)
  })

  it('follows the References chain, not just In-Reply-To', () => {
    const root = message({ subject: 'Projekt' })
    const reply = message({
      subject: 'Re: Projekt',
      referencesHeader: `${root.messageIdHeader}`
    })
    expect(buildThreads([root, reply])).toHaveLength(1)
  })

  it('still groups when the mailer sent no threading headers', () => {
    const first = message({ subject: 'Rechnung', messageIdHeader: null })
    const second = message({ subject: 'Re: Rechnung', messageIdHeader: null })
    expect(buildThreads([first, second])).toHaveLength(1)
  })

  it('keeps unrelated messages apart', () => {
    expect(buildThreads([message({ subject: 'Eins' }), message({ subject: 'Zwei' })])).toHaveLength(2)
  })

  it('reports the newest date and the unread count of the conversation', () => {
    const root = message({ subject: 'Angebot', date: '2026-08-01T10:00:00.000Z' })
    const reply = message({
      subject: 'Re: Angebot',
      inReplyTo: root.messageIdHeader,
      date: '2026-08-09T10:00:00.000Z',
      isRead: false
    })
    const [thread] = buildThreads([root, reply])
    expect(thread.latestDate).toBe('2026-08-09T10:00:00.000Z')
    expect(thread.unreadCount).toBe(1)
  })

  it('caps the indent so long chains stay readable', () => {
    let previous = message({ subject: 'Kette' })
    const chain = [previous]
    for (let i = 0; i < 6; i += 1) {
      previous = message({ subject: 'Re: Kette', inReplyTo: previous.messageIdHeader })
      chain.push(previous)
    }
    const [thread] = buildThreads(chain)
    expect(Math.max(...thread.nodes.map((n) => n.depth))).toBeLessThanOrEqual(3)
  })
})

describe('threadRows', () => {
  it('shows only the newest message of a collapsed conversation', () => {
    const root = message({ subject: 'Angebot' })
    const reply = message({ subject: 'Re: Angebot', inReplyTo: root.messageIdHeader })
    const rows = threadRows([root, reply], new Set([root.id]))

    expect(rows).toHaveLength(1)
    expect(rows[0].message.id).toBe(reply.id)
    expect(rows[0].threadSize).toBe(2)
  })

  it('shows every message of an expanded conversation', () => {
    const root = message({ subject: 'Angebot' })
    const reply = message({ subject: 'Re: Angebot', inReplyTo: root.messageIdHeader })
    expect(threadRows([root, reply], new Set())).toHaveLength(2)
  })

  it('reports single messages as conversations of size one', () => {
    const rows = threadRows([message({ subject: 'Allein' })], new Set())
    expect(rows[0].threadSize).toBe(1)
    expect(rows[0].depth).toBe(0)
  })
})
