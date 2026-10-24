import { beforeAll, describe, expect, it } from 'vitest'
import { parsePgpMime } from '@peregrine/core/pgpMimeParser'
import type { ComposeInput } from '@peregrine/core/types'
import { addAccount, type NewAccount } from '../accounts'
import { composeFromInput } from '../send'
import { migratedDatabase } from '../testing/testDb'
import { saveContactKey, saveOwnKey } from './keyStore'
import { decryptMessage, generateKeyPair, verifyDetached, type KeyPair } from './pgpService'
import { protectionProblem } from './protect'

const NEW_ACCOUNT: NewAccount = {
  displayName: 'Alex',
  emailAddress: 'alex@example.org',
  imapHost: 'imap.example.org',
  imapPort: 993,
  imapSecure: 'tls',
  imapUsername: 'alex',
  smtpHost: 'smtp.example.org',
  smtpPort: null,
  smtpSecure: null,
  smtpUsername: null,
  password: 'secret',
  smtpPassword: null
}

const input = (accountId: string, over: Partial<ComposeInput> = {}): ComposeInput => ({
  accountId,
  to: [{ name: 'Sam', address: 'sam@example.net' }],
  cc: [],
  bcc: [],
  subject: 'Quarterly plan',
  textBody: 'The numbers: café, naïve',
  htmlBody: '',
  attachments: [],
  ...over
})

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

let alex: KeyPair
let sam: KeyPair

beforeAll(async () => {
  alex = await generateKeyPair('Alex', 'alex@example.org')
  sam = await generateKeyPair('Sam', 'sam@example.net')
})

async function setup(keys: { own?: boolean; sam?: boolean } = { own: true, sam: true }) {
  const { db } = await migratedDatabase()
  const account = await addAccount(db, NEW_ACCOUNT)
  if (keys.own) {
    await saveOwnKey(db, { fingerprint: alex.fingerprint, accountId: account.id, publicKey: alex.publicKey, privateKey: alex.privateKey, createdAt: 1 })
  }
  if (keys.sam) await saveContactKey(db, { fingerprint: sam.fingerprint, address: 'sam@example.net', publicKey: sam.publicKey, createdAt: 1 })
  return { db, account }
}

describe('a message that is signed', () => {
  it('carries its content as it was signed and a signature that the sender key checks', async () => {
    const { db, account } = await setup()
    const composed = await composeFromInput(db, account, input(account.id, { sign: true }), undefined)
    const parsed = parsePgpMime(text(composed.source))
    expect(parsed.kind).toBe('signed')
    if (parsed.kind !== 'signed') return
    expect(parsed.signedEntity).toContain('quoted-printable')
    expect(await verifyDetached(parsed.signedEntity, parsed.signature, [alex.publicKey])).toBe('valid')
    expect(await verifyDetached(parsed.signedEntity + ' ', parsed.signature, [alex.publicKey])).toBe('invalid')
  })

  it('keeps its addressing readable outside', async () => {
    const { db, account } = await setup()
    const source = text((await composeFromInput(db, account, input(account.id, { sign: true }), undefined)).source)
    expect(source).toMatch(/^Subject: Quarterly plan\r$/m)
    expect(source).toMatch(/^To: Sam <sam@example\.net>\r$/m)
  })

  it('is signed with attachments inside the signature', async () => {
    const { db, account } = await setup()
    const files = { read: async () => new Uint8Array([1, 2, 3]) } as never
    const composed = await composeFromInput(
      db,
      account,
      input(account.id, { sign: true, attachments: [{ filename: 'a.bin', path: '/x/a.bin', contentType: 'application/octet-stream' }] }),
      files
    )
    const parsed = parsePgpMime(text(composed.source))
    expect(parsed.kind === 'signed' && parsed.signedEntity.includes('multipart/mixed')).toBe(true)
    expect(parsed.kind === 'signed' && (await verifyDetached(parsed.signedEntity, parsed.signature, [alex.publicKey]))).toBe('valid')
  })
})

describe('a message that is encrypted', () => {
  it('can be opened by the recipient and by the sender, and says who signed it', async () => {
    const { db, account } = await setup()
    const composed = await composeFromInput(db, account, input(account.id, { encrypt: true }), undefined)
    const source = text(composed.source)
    expect(source).not.toContain('numbers')
    const parsed = parsePgpMime(source)
    expect(parsed.kind).toBe('encrypted')
    if (parsed.kind !== 'encrypted') return
    const forSam = await decryptMessage(parsed.ciphertext, [sam.privateKey], [alex.publicKey])
    expect(forSam.signed).toBe(true)
    expect(forSam.text).toContain('Content-Type: text/plain')
    expect(forSam.text).toContain('caf=C3=A9')
    expect((await decryptMessage(parsed.ciphertext, [alex.privateKey], [])).text).toBe(forSam.text)
  })

  it('is encrypted to everybody it goes to, the copies and the hidden ones too', async () => {
    const { db, account } = await setup()
    const eve = await generateKeyPair('Eve', 'eve@example.net')
    await saveContactKey(db, { fingerprint: eve.fingerprint, address: 'Eve@Example.net', publicKey: eve.publicKey, createdAt: 1 })
    const composed = await composeFromInput(
      db,
      account,
      input(account.id, { encrypt: true, bcc: [{ name: '', address: 'eve@example.net' }] }),
      undefined
    )
    const parsed = parsePgpMime(text(composed.source))
    if (parsed.kind !== 'encrypted') throw new Error('not encrypted')
    expect((await decryptMessage(parsed.ciphertext, [eve.privateKey], [])).text).toContain('Content-Type')
    expect((await decryptMessage(parsed.ciphertext, [sam.privateKey], [])).text).toContain('Content-Type')
  })

  it('is refused, naming those without a key, and is not written in the clear', async () => {
    const { db, account } = await setup({ own: true, sam: false })
    await expect(composeFromInput(db, account, input(account.id, { encrypt: true }), undefined)).rejects.toThrow('sam@example.net')
  })
})

describe('a draft', () => {
  it('that is to be encrypted is encrypted to its author alone, whoever it is for', async () => {
    const { db, account } = await setup({ own: true, sam: false })
    const composed = await composeFromInput(db, account, input(account.id, { encrypt: true }), undefined, { draft: true })
    const parsed = parsePgpMime(text(composed.source))
    if (parsed.kind !== 'encrypted') throw new Error('not encrypted')
    expect((await decryptMessage(parsed.ciphertext, [alex.privateKey], [])).text).toContain('Content-Type')
    await expect(decryptMessage(parsed.ciphertext, [sam.privateKey], [])).rejects.toThrow()
  })

  it('that is only to be signed is kept as it is', async () => {
    const { db, account } = await setup()
    const composed = await composeFromInput(db, account, input(account.id, { sign: true }), undefined, { draft: true })
    expect(parsePgpMime(text(composed.source)).kind).toBe('none')
    expect(text(composed.source)).toContain('numbers')
  })
})

describe('what is asked of a message and cannot be done', () => {
  it('is nothing for a message that asks for nothing', async () => {
    const { db, account } = await setup({})
    expect(await protectionProblem(db, account.id, { encrypt: false, sign: false }, ['sam@example.net'])).toBeNull()
  })

  it('is said when the account has no key', async () => {
    const { db, account } = await setup({ sam: true })
    expect(await protectionProblem(db, account.id, { encrypt: false, sign: true }, [])).toMatch(/keinen Schlüssel/)
  })

  it('is said with the addresses that lack a key', async () => {
    const { db, account } = await setup({ own: true })
    expect(await protectionProblem(db, account.id, { encrypt: true, sign: false }, ['sam@example.net', 'kim@example.net'])).toMatch(
      /sam@example\.net, kim@example\.net/
    )
  })

  it('does not ask for the keys of the recipients of a draft', async () => {
    const { db, account } = await setup({ own: true })
    expect(await protectionProblem(db, account.id, { encrypt: true, sign: false }, ['sam@example.net'], { draft: true })).toBeNull()
  })
})
