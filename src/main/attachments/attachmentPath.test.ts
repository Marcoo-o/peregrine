import { join, sep } from 'node:path'
import { simpleParser } from 'mailparser'
import { describe, expect, it } from 'vitest'
import { isInside, safeFilename } from '@peregrine/core/safeFilename'

/**
 * The file name on an attachment is written by whoever sent the message, and it used to be
 * joined onto the cache directory as it arrived. A message could therefore choose where its
 * attachment was written, including the Startup folder.
 *
 * These go through mailparser rather than testing the helper on hand written strings, because
 * the first attempt to prove the problem tested a string that had lost its backslashes on the
 * way in and concluded there was nothing wrong. What matters is the name that actually comes
 * out of the parser, so that is what is fed in here.
 */

function craft(disposition: string): string {
  return [
    'From: attacker@example.invalid',
    'To: victim@example.invalid',
    'Subject: Invoice',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="b"',
    '',
    '--b',
    'Content-Type: application/octet-stream',
    `Content-Disposition: attachment; ${disposition}`,
    '',
    'x',
    '',
    '--b--',
    ''
  ].join('\r\n')
}

const CACHE = join('C:', 'cache', 'peregrine', 'attachments', 'account', 'message')

async function nameFromMail(disposition: string): Promise<string | null> {
  const mail = await simpleParser(Buffer.from(craft(disposition), 'utf8'))
  return mail.attachments[0]?.filename ?? null
}

describe('a name from a message cannot choose where the file lands', () => {
  it.each([
    ['plain backslashes', 'filename="..\\..\\..\\Startup\\evil.cmd"'],
    ['plain slashes', 'filename="../../../Startup/evil.cmd"'],
    ['percent encoded, rfc 2231', "filename*=UTF-8''%2e%2e%2f%2e%2e%2fevil.cmd"],
    ['base64 encoded, rfc 2047', 'filename="=?utf-8?B?Li4vLi4vZXZpbC5jbWQ=?="'],
    ['doubled dots', 'filename="....//....//evil.cmd"'],
    ['an absolute path', 'filename="C:\\Windows\\System32\\evil.exe"'],
    ['nothing but dots', 'filename=".."']
  ])('%s', async (_name, disposition) => {
    const raw = await nameFromMail(disposition)
    expect(isInside(CACHE, join(CACHE, safeFilename(raw, 'fallback-id')), sep)).toBe(true)
  })

  it('is still an escape before the name is cleaned, so the test means something', async () => {
    const raw = await nameFromMail('filename="../../../Startup/evil.cmd"')
    expect(raw).toBe('../../../Startup/evil.cmd')
    expect(isInside(CACHE, join(CACHE, raw as string), sep)).toBe(false)
  })
})

describe('ordinary attachments keep their names', () => {
  it.each([
    'Rechnung 2026-08.pdf',
    'Angebot (final).docx',
    'Bild_01.jpeg',
    'Präsentation & Notizen.pptx'
  ])('%s', (name) => {
    expect(safeFilename(name, 'fallback-id')).toBe(name)
  })
})
