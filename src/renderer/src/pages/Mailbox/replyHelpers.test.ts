import { describe, expect, it } from 'vitest'
import type { MessageDetail } from '@peregrine/core/types'
import { buildForward, buildReply, buildReplyAll } from './replyHelpers'

function message(overrides: Partial<MessageDetail> = {}): MessageDetail {
  return {
    id: 'm1',
    accountId: 'a1',
    folderId: 'f1',
    uid: 7,
    subject: 'Angebot',
    from: [{ name: 'Andreas', address: 'andreas@example.org' }],
    to: [{ name: 'John', address: 'john@example.org' }],
    cc: [],
    bcc: [],
    replyTo: [],
    authResults: { spf: 'unknown', dkim: 'unknown', dmarc: 'unknown' },
    spam: null,
    date: '2026-08-05T14:20:00.000Z',
    messageIdHeader: '<abc@example.org>',
    inReplyTo: null,
    referencesHeader: null,
    textBody: 'Hallo',
    htmlBody: null,
    attachments: [],
    pgpStatus: 'none',
    pendingMoveTo: null,
    ...overrides
  }
}

describe('buildReply', () => {
  it('addresses the sender and threads the reply', () => {
    const reply = buildReply(message())
    expect(reply.to).toBe('andreas@example.org')
    expect(reply.inReplyTo).toBe('<abc@example.org>')
    expect(reply.references).toBe('<abc@example.org>')
  })

  it('does not stack Re: prefixes', () => {
    expect(buildReply(message({ subject: 'Re: Angebot' })).subject).toBe('Re: Angebot')
    expect(buildReply(message({ subject: 'Angebot' })).subject).toBe('Re: Angebot')
  })

  it('appends the existing references chain', () => {
    const reply = buildReply(message({ referencesHeader: '<root@example.org>' }))
    expect(reply.references).toBe('<root@example.org> <abc@example.org>')
  })

  it('quotes the original body', () => {
    expect(buildReply(message({ textBody: 'Zeile1\nZeile2' })).textBody).toContain('> Zeile1')
  })
})

describe('buildReplyAll', () => {
  it('keeps the other recipients but never the replying identity', () => {
    const reply = buildReplyAll(
      message({
        to: [
          { name: 'John', address: 'john@example.org' },
          { name: 'Team', address: 'team@example.org' }
        ],
        cc: [{ name: 'Chef', address: 'chef@example.org' }]
      }),
      'john@example.org'
    )
    expect(reply.to).toBe('andreas@example.org, team@example.org')
    expect(reply.cc).toBe('chef@example.org')
  })

  it('matches the own address case-insensitively and removes duplicates', () => {
    const reply = buildReplyAll(
      message({
        from: [{ name: '', address: 'Andreas@Example.org' }],
        to: [
          { name: '', address: 'JOHN@example.org' },
          { name: '', address: 'andreas@example.org' }
        ]
      }),
      'john@example.org'
    )
    expect(reply.to).toBe('Andreas@Example.org')
  })

  it('keeps every recipient when the account address is unknown', () => {
    const reply = buildReplyAll(message(), undefined)
    expect(reply.to).toBe('andreas@example.org, john@example.org')
  })
})

describe('buildForward', () => {
  it('starts without a recipient and prefixes the subject once', () => {
    expect(buildForward(message()).to).toBe('')
    expect(buildForward(message()).subject).toBe('Fwd: Angebot')
    expect(buildForward(message({ subject: 'Fwd: Angebot' })).subject).toBe('Fwd: Angebot')
  })
})
