import { beforeAll, describe, expect, it } from 'vitest'
import { parsePgpMime } from '@peregrine/core/pgpMimeParser'
import type { ComposeInput } from '@peregrine/core/types'
import { addAccount, type NewAccount } from '../accounts'
import { composeFromInput } from '../send'
import { appHarness } from '../testing/appHarness'
import { migratedDatabase } from '../testing/testDb'
import { activeKey, chooseRecipientKey, chooseSigningKey, loadKeyChoice, preferFirst } from './keyChoice'
import { saveContactKey, saveOwnKey } from './keyStore'
import { decryptMessage, generateKeyPair, verifyDetached, type KeyPair } from './pgpService'
import type { KeysState } from '../app/screens'

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
  subject: 'Plan',
  textBody: 'Hello',
  htmlBody: '',
  attachments: [],
  ...over
})

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

let older: KeyPair
let newer: KeyPair
let samOld: KeyPair
let samNew: KeyPair

beforeAll(async () => {
  older = await generateKeyPair('Alex', 'alex@example.org')
  newer = await generateKeyPair('Alex', 'alex@example.org')
  samOld = await generateKeyPair('Sam', 'sam@example.net')
  samNew = await generateKeyPair('Sam', 'sam@example.net')
})

async function withTwoKeys() {
  const { db } = await migratedDatabase()
  const account = await addAccount(db, NEW_ACCOUNT)
  await saveOwnKey(db, { fingerprint: older.fingerprint, accountId: account.id, publicKey: older.publicKey, privateKey: older.privateKey, createdAt: 1 })
  await saveOwnKey(db, { fingerprint: newer.fingerprint, accountId: account.id, publicKey: newer.publicKey, privateKey: newer.privateKey, createdAt: 2 })
  await saveContactKey(db, { fingerprint: samOld.fingerprint, address: 'sam@example.net', publicKey: samOld.publicKey, createdAt: 1 })
  await saveContactKey(db, { fingerprint: samNew.fingerprint, address: 'sam@example.net', publicKey: samNew.publicKey, createdAt: 2 })
  return { db, account }
}

describe('the choice of a key', () => {
  it('is none to begin with, and is kept for an account and for an address without regard to its case', async () => {
    const { db, account } = await migratedDatabase().then(async ({ db }) => ({ db, account: await addAccount(db, NEW_ACCOUNT) }))
    expect(await loadKeyChoice(db)).toEqual({ signing: {}, recipient: {} })
    await chooseSigningKey(db, account.id, 'AAAA')
    await chooseRecipientKey(db, ' Sam@Example.NET ', 'BBBB')
    expect(await loadKeyChoice(db)).toEqual({ signing: { [account.id]: 'AAAA' }, recipient: { 'sam@example.net': 'BBBB' } })
  })

  it('puts the chosen key first and leaves the others as they were, and a choice that names no key changes nothing', () => {
    const keys = [{ fingerprint: 'a' }, { fingerprint: 'b' }, { fingerprint: 'c' }]
    expect(preferFirst(keys, 'c').map((key) => key.fingerprint)).toEqual(['c', 'a', 'b'])
    expect(preferFirst(keys, 'z')).toEqual(keys)
    expect(preferFirst(keys, undefined)).toBe(keys)
  })

  it('is the chosen key while it can be used, else the first that can, else the first', () => {
    const keys = [{ fingerprint: 'a' }, { fingerprint: 'b' }, { fingerprint: 'c' }]
    expect(activeKey(keys, 'c', () => true)?.fingerprint).toBe('c')
    expect(activeKey(keys, 'c', (key) => key.fingerprint !== 'c')?.fingerprint).toBe('a')
    expect(activeKey(keys, undefined, () => false)?.fingerprint).toBe('a')
    expect(activeKey([], undefined, () => true)).toBeUndefined()
  })
})

describe('signing with the key that was chosen', () => {
  it('is signed with the newest key until another is chosen, and then with that one', async () => {
    const { db, account } = await withTwoKeys()
    const parse = async () => {
      const parsed = parsePgpMime(text((await composeFromInput(db, account, input(account.id, { sign: true }), undefined)).source))
      if (parsed.kind !== 'signed') throw new Error('not signed')
      return parsed
    }
    let signed = await parse()
    expect(await verifyDetached(signed.signedEntity, signed.signature, [newer.publicKey])).toBe('valid')
    expect(await verifyDetached(signed.signedEntity, signed.signature, [older.publicKey])).not.toBe('valid')
    await chooseSigningKey(db, account.id, older.fingerprint)
    signed = await parse()
    expect(await verifyDetached(signed.signedEntity, signed.signature, [older.publicKey])).toBe('valid')
  })
})

describe('encrypting to the key that was chosen for an address', () => {
  it('is encrypted to the newest key until another is chosen, and then to that one, and still to the sender', async () => {
    const { db, account } = await withTwoKeys()
    const open = async (privateKey: string) => {
      const parsed = parsePgpMime(text((await composeFromInput(db, account, input(account.id, { encrypt: true }), undefined)).source))
      if (parsed.kind !== 'encrypted') throw new Error('not encrypted')
      return decryptMessage(parsed.ciphertext, [privateKey], [])
    }
    await expect(open(samNew.privateKey)).resolves.toBeTruthy()
    await expect(open(samOld.privateKey)).rejects.toThrow()
    await chooseRecipientKey(db, 'sam@example.net', samOld.fingerprint)
    await expect(open(samOld.privateKey)).resolves.toBeTruthy()
    await expect(open(samNew.privateKey)).rejects.toThrow()
    await expect(open(newer.privateKey)).resolves.toBeTruthy()
  })
})

describe('choosing on the keys screen', () => {
  it('keeps the choice, says so, and shows it in the state of the screen', async () => {
    const t = await appHarness()
    const work = await t.givenAccount('work', {})
    await saveOwnKey(t.db, { fingerprint: older.fingerprint, accountId: work.id, publicKey: older.publicKey, privateKey: older.privateKey, createdAt: 1 })
    await saveContactKey(t.db, { fingerprint: samOld.fingerprint, address: 'sam@example.net', publicKey: samOld.publicKey, createdAt: 1 })
    await t.app.keys.useForSigning(work.id, older.fingerprint)
    expect((t.store.screen as KeysState).choice.signing[work.id]).toBe(older.fingerprint)
    expect((t.store.screen as KeysState).notice).toContain('signiert')
    await t.app.keys.useForRecipient('Sam@example.net', samOld.fingerprint)
    expect((t.store.screen as KeysState).choice.recipient['sam@example.net']).toBe(samOld.fingerprint)
  })
})

describe('looking for the key of a recipient while writing', () => {
  it('names the recipients there is no key for, and looks only when asked, keeping what is found only when taken', async () => {
    const t = await appHarness()
    await t.givenAccount('work', {})
    await saveContactKey(t.db, { fingerprint: samOld.fingerprint, address: 'sam@example.net', publicKey: samOld.publicKey, createdAt: 1 })
    expect(await t.app.keys.withoutKey(['sam@example.net', 'kim@example.net'])).toEqual(['kim@example.net'])

    const kim = await generateKeyPair('Kim', 'kim@example.net')
    let asked = 0
    t.app.keys.lookup = async () => {
      asked += 1
      return { source: 'WKD', keys: [{ fingerprint: kim.fingerprint, userIds: ['Kim <kim@example.net>'], addresses: ['kim@example.net'], publicKey: kim.publicKey, locked: false, expiresAt: null }] }
    }
    const found = await t.app.keys.lookupForCompose('kim@example.net')
    expect(asked).toBe(1)
    expect(found).toMatchObject({ keys: [{ fingerprint: kim.fingerprint, foundBy: expect.stringContaining('example.net') }] })
    expect(await t.app.keys.withoutKey(['kim@example.net'])).toEqual(['kim@example.net'])
    if ('keys' in found) await t.app.keys.adoptForCompose('kim@example.net', found.keys[0])
    expect(await t.app.keys.withoutKey(['kim@example.net'])).toEqual([])
  })

  it('says why nothing was found, in the words of the keys screen', async () => {
    const t = await appHarness()
    await t.givenAccount('work', {})
    const { KeyLookupError } = await import('./keyLookup')
    t.app.keys.lookup = async () => {
      throw new KeyLookupError('notFound')
    }
    expect(await t.app.keys.lookupForCompose('kim@example.net')).toEqual({ error: expect.stringContaining('kein Schlüssel veröffentlicht') })
  })
})
