import { beforeAll, describe, expect, it } from 'vitest'
import * as openpgp from 'openpgp'
import type { SqlDb } from '@peregrine/core/sqlDb'
import type { ComposeInput } from '@peregrine/core/types'
import { addAccount, type Account, type NewAccount } from '../accounts'
import { listAttachments } from '../attachments'
import { readMessage } from '../messageText'
import { composeFromInput } from '../send'
import { migratedDatabase } from '../testing/testDb'
import { saveContactKey, saveOwnKey } from './keyStore'
import { generateKeyPair, type KeyPair } from './pgpService'
import { readProtected } from './readProtected'

const NEW_ACCOUNT: NewAccount = {
  displayName: 'Sam',
  emailAddress: 'sam@example.net',
  imapHost: 'imap.example.net',
  imapPort: 993,
  imapSecure: 'tls',
  imapUsername: 'sam',
  smtpHost: null,
  smtpPort: null,
  smtpSecure: null,
  smtpUsername: null,
  password: 'secret',
  smtpPassword: null
}

const FROM_ALEX: NewAccount = { ...NEW_ACCOUNT, displayName: 'Alex', emailAddress: 'alex@example.org' }

let alex: KeyPair
let sam: KeyPair
let eve: KeyPair

beforeAll(async () => {
  alex = await generateKeyPair('Alex', 'alex@example.org')
  sam = await generateKeyPair('Sam', 'sam@example.net')
  eve = await generateKeyPair('Eve', 'eve@attacker.test')
})

const input = (accountId: string, over: Partial<ComposeInput> = {}): ComposeInput => ({
  accountId,
  to: [{ name: 'Sam', address: 'sam@example.net' }],
  cc: [],
  bcc: [],
  subject: 'Quarterly plan',
  textBody: 'The numbers: café',
  htmlBody: '',
  attachments: [],
  ...over
})

/** Alex writes to Sam; the message is what Sam's phone has. Sam's database holds Sam's key, and Alex's when asked. */
async function sent(over: Partial<ComposeInput>, held: { alexKey?: boolean } = { alexKey: true }) {
  const writer = await migratedDatabase()
  const alexAccount = await addAccount(writer.db, FROM_ALEX)
  await saveOwnKey(writer.db, { fingerprint: alex.fingerprint, accountId: alexAccount.id, publicKey: alex.publicKey, privateKey: alex.privateKey, createdAt: 1 })
  await saveContactKey(writer.db, { fingerprint: sam.fingerprint, address: 'sam@example.net', publicKey: sam.publicKey, createdAt: 1 })
  const files = { read: async () => new TextEncoder().encode('%PDF plan') } as never
  const composed = await composeFromInput(writer.db, alexAccount, input(alexAccount.id, over), files)

  const reader = await migratedDatabase()
  const samAccount: Account = await addAccount(reader.db, NEW_ACCOUNT)
  await saveOwnKey(reader.db, { fingerprint: sam.fingerprint, accountId: samAccount.id, publicKey: sam.publicKey, privateKey: sam.privateKey, createdAt: 1 })
  if (held.alexKey) await saveContactKey(reader.db, { fingerprint: alex.fingerprint, address: 'alex@example.org', publicKey: alex.publicKey, createdAt: 1 })
  return { ...reader, account: samAccount, source: composed.source }
}

const read = (t: { db: SqlDb; account: Account; source: Uint8Array }) => readProtected(t.db, t.account, t.source, readMessage(t.source))

describe('a message that is neither', () => {
  it('is left as it came', async () => {
    const t = await sent({})
    const reading = await read(t)
    expect(reading).toEqual({ status: 'none', source: t.source })
  })
})

describe('a signed message', () => {
  it('is verified against the key held for the sender', async () => {
    const t = await sent({ sign: true })
    const reading = await read(t)
    expect(reading.status).toBe('signed-verified')
    expect(readMessage(reading.source).text).toBe('The numbers: café')
  })

  it('is said to be signed but not checked when no key of the sender is held', async () => {
    const t = await sent({ sign: true }, { alexKey: false })
    expect((await read(t)).status).toBe('signed-unverified')
  })

  it('is said to be invalid when the key held for the sender did not make the signature', async () => {
    const t = await sent({ sign: true })
    await saveContactKey(t.db, { fingerprint: eve.fingerprint, address: 'alex@example.org', publicKey: eve.publicKey, createdAt: 2 })
    // Both keys are held for the address; the one that signed is among them.
    expect((await read(t)).status).toBe('signed-verified')
    const only = await sent({ sign: true }, { alexKey: false })
    await saveContactKey(only.db, { fingerprint: eve.fingerprint, address: 'alex@example.org', publicKey: eve.publicKey, createdAt: 2 })
    expect((await read(only)).status).toBe('signed-invalid')
  })

  it('is invalid when the content was changed after it was signed', async () => {
    const t = await sent({ sign: true })
    const changed = new TextEncoder().encode(new TextDecoder().decode(t.source).replace('The numbers', 'Other numbers'))
    const reading = await readProtected(t.db, t.account, changed, readMessage(changed))
    // The text is quoted-printable but ASCII here, so the replacement changes the signed bytes.
    expect(reading.status).toBe('signed-invalid')
  })
})

describe('an encrypted message', () => {
  it('is opened, with the content read as the message it was', async () => {
    const t = await sent({
      encrypt: true,
      attachments: [{ filename: 'plan.pdf', path: '/x/plan.pdf', contentType: 'application/pdf' }]
    })
    const reading = await read(t)
    expect(reading.status).toBe('encrypted-verified')
    const message = readMessage(reading.source)
    expect(message.text).toBe('The numbers: café')
    expect(message.subject).toBe('Quarterly plan')
    expect(message.from).toContain('alex@example.org')
    expect(listAttachments(reading.source).map((attachment) => attachment.filename)).toEqual(['plan.pdf'])
  })

  it('is opened and said not to be checked when the sender is not known', async () => {
    const t = await sent({ encrypt: true }, { alexKey: false })
    const reading = await read(t)
    expect(reading.status).toBe('encrypted-unverified')
    expect(readMessage(reading.source).text).toBe('The numbers: café')
  })

  it('is said not to be readable when the account has no key for it', async () => {
    const t = await sent({ encrypt: true })
    const other = await migratedDatabase()
    const account = await addAccount(other.db, NEW_ACCOUNT)
    await saveOwnKey(other.db, { fingerprint: eve.fingerprint, accountId: account.id, publicKey: eve.publicKey, privateKey: eve.privateKey, createdAt: 1 })
    const reading = await readProtected(other.db, account, t.source, readMessage(t.source))
    expect(reading.status).toBe('encrypted-failed')
    expect(reading.source).toBe(t.source)
  })

  it('is said not to be readable when the account has no key at all', async () => {
    const t = await sent({ encrypt: true })
    const other = await migratedDatabase()
    const account = await addAccount(other.db, NEW_ACCOUNT)
    expect((await readProtected(other.db, account, t.source, readMessage(t.source))).status).toBe('encrypted-failed')
  })

  it('keeps the outer headers and drops the old content headers', async () => {
    const t = await sent({ encrypt: true })
    const reading = await read(t)
    const text = new TextDecoder().decode(reading.source)
    expect(text).not.toContain('multipart/encrypted')
    expect(text.match(/^MIME-Version:/gm)).toHaveLength(1)
    expect(text).toMatch(/^Subject: Quarterly plan\r$/m)
  })

  it('reads a copy in the sent folder, which is signed by the account itself', async () => {
    const writer = await migratedDatabase()
    const account = await addAccount(writer.db, FROM_ALEX)
    await saveOwnKey(writer.db, { fingerprint: alex.fingerprint, accountId: account.id, publicKey: alex.publicKey, privateKey: alex.privateKey, createdAt: 1 })
    await saveContactKey(writer.db, { fingerprint: sam.fingerprint, address: 'sam@example.net', publicKey: sam.publicKey, createdAt: 1 })
    const composed = await composeFromInput(writer.db, account, input(account.id, { encrypt: true }), undefined)
    const reading = await readProtected(writer.db, account, composed.source, readMessage(composed.source))
    expect(reading.status).toBe('encrypted-verified')
  })
})

describe('the inline forms', () => {
  it('reads a text signed in the old inline way', async () => {
    const t = await sent({})
    const cleartext = (await openpgp.sign({
      message: await openpgp.createCleartextMessage({ text: 'Plain words' }),
      signingKeys: await openpgp.readPrivateKey({ armoredKey: alex.privateKey })
    })) as string
    const source = new TextEncoder().encode(`From: Alex <alex@example.org>\r\nTo: sam@example.net\r\nSubject: Old\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${cleartext.replace(/\n/g, '\r\n')}`)
    const reading = await readProtected(t.db, t.account, source, readMessage(source))
    expect(reading.status).toBe('signed-verified')
    expect(reading.text).toBe('Plain words')
  })

  it('opens a text encrypted in the old inline way', async () => {
    const t = await sent({})
    const armored = (await openpgp.encrypt({
      message: await openpgp.createMessage({ text: 'Secret words' }),
      encryptionKeys: await openpgp.readKey({ armoredKey: sam.publicKey }),
      signingKeys: await openpgp.readPrivateKey({ armoredKey: alex.privateKey })
    })) as string
    const source = new TextEncoder().encode(`From: Alex <alex@example.org>\r\nTo: sam@example.net\r\nSubject: Old\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${armored.replace(/\n/g, '\r\n')}`)
    const reading = await readProtected(t.db, t.account, source, readMessage(source))
    expect(reading.status).toBe('encrypted-verified')
    expect(reading.text).toBe('Secret words')
  })
})
