import { describe, expect, it } from 'vitest'
import { parseAuthResultsHeader, parseReplyTo } from '../db/repositories/messagesRepo'
import { headersJsonOf } from './headers'

/**
 * A PGP/MIME message the way one actually arrives: the envelope in the clear, the body an
 * opaque encrypted part. The Reply-To points at a different domain than the sender. That is
 * how a reply gets diverted, and it stays invisible until the reply has been written.
 */
const ENCRYPTED = Buffer.from(
  [
    'Return-Path: <buchhaltung@lieferant.example>',
    'Authentication-Results: mx.peregrine.example;',
    ' spf=pass smtp.mailfrom=lieferant.example;',
    ' dkim=pass header.d=lieferant.example;',
    ' dmarc=pass header.from=lieferant.example',
    'From: Buchhaltung <buchhaltung@lieferant.example>',
    'Reply-To: Buchhaltung <zahlung@lieferant-rechnung.example>',
    'To: John <john@peregrine.example>',
    'Subject: Rechnung 4711',
    'Date: Tue, 05 Aug 2026 09:14:00 +0200',
    'Content-Type: multipart/encrypted; protocol="application/pgp-encrypted";',
    ' boundary="grenze"',
    '',
    '--grenze',
    'Content-Type: application/pgp-encrypted',
    '',
    'Version: 1',
    '',
    '--grenze',
    'Content-Type: application/octet-stream',
    '',
    '-----BEGIN PGP MESSAGE-----',
    '',
    'hQIMA0hgibbeispiel',
    '-----END PGP MESSAGE-----',
    '',
    '--grenze--',
    ''
  ].join('\r\n'),
  'utf8'
)

describe('headersJsonOf', () => {
  // The point of the whole exercise: before this, a PGP message stored only its source, so
  // both checks below silently reported "nothing to see" on exactly the messages that carry
  // the most trust.
  it('keeps the Reply-To of an encrypted message readable', async () => {
    const replyTo = parseReplyTo(await headersJsonOf(ENCRYPTED))
    expect(replyTo).toEqual([
      { name: 'Buchhaltung', address: 'zahlung@lieferant-rechnung.example' }
    ])
  })

  it('keeps Authentication-Results of an encrypted message readable', async () => {
    const results = parseAuthResultsHeader(await headersJsonOf(ENCRYPTED))
    expect(results.spf).toBe('pass')
    expect(results.dkim).toBe('pass')
    expect(results.dmarc).toBe('pass')
  })

  it('does not store the ciphertext along with the headers', async () => {
    expect(await headersJsonOf(ENCRYPTED)).not.toContain('BEGIN PGP MESSAGE')
  })

  // Empty headers, not a thrown error: the source is what matters for a PGP message, and
  // refusing to store it over an unparseable envelope would lose the message itself.
  it('yields empty headers for something that is not a message', async () => {
    expect(parseReplyTo(await headersJsonOf(Buffer.from('kein Kopfteil', 'utf8')))).toEqual([])
  })
})
