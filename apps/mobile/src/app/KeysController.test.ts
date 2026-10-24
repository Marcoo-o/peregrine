import { beforeAll, describe, expect, it } from 'vitest'
import * as openpgp from 'openpgp'
import { encodeUtf8 } from '@peregrine/imap/utf8'
import { contactKeysFor, listOwnKeys } from '../pgp/keyStore'
import { generateKeyPair, type KeyPair } from '../pgp/pgpService'
import { appHarness } from '../testing/appHarness'
import type { KeysState } from './screens'

let sam: KeyPair

beforeAll(async () => {
  sam = await generateKeyPair('Sam', 'sam@example.net')
})

async function keys() {
  const t = await appHarness()
  const work = await t.givenAccount('work', {})
  await t.app.keys.show()
  const shown = () => t.store.screen as KeysState
  return { ...t, work, shown }
}

describe('the keys screen', () => {
  it('shows the accounts, with no key for any of them yet, and no keys of others', async () => {
    const t = await keys()
    expect(t.shown()).toMatchObject({ name: 'keys', own: { [t.work.id]: [] }, contacts: [] })
    expect(t.shown().accounts.map((account) => account.id)).toEqual([t.work.id])
  })
})

describe('making a key', () => {
  it('gives the account a key for its address, which is the one that signs', async () => {
    const t = await keys()
    await t.app.keys.generate(t.work.id)
    const [made] = await listOwnKeys(t.db, t.work.id)
    expect(made.publicKey).toContain('PUBLIC KEY BLOCK')
    expect(made.privateKey).toContain('PRIVATE KEY BLOCK')
    expect(t.shown().own[t.work.id]).toHaveLength(1)
    expect(t.shown().notice).toContain(t.work.emailAddress)
  })

  it('says so for an account that has no address to make it for', async () => {
    const t = await appHarness()
    const noAddress = await t.givenAccount('a', {}, { emailAddress: '' })
    await t.app.keys.show()
    await t.app.keys.generate(noAddress.id)
    expect((t.store.screen as KeysState).error).toMatch(/keine Absenderadresse/)
    expect(await listOwnKeys(t.db, noAddress.id)).toEqual([])
  })
})

describe('reading keys', () => {
  it('shows what is in pasted text and stores nothing yet', async () => {
    const t = await keys()
    await t.app.keys.scan(sam.publicKey)
    expect(t.shown().found?.map((key) => key.addresses)).toEqual([['sam@example.net']])
    expect(await contactKeysFor(t.db, 'sam@example.net')).toEqual([])
  })

  it('reads a file that was picked, and removes the copy that was made of it', async () => {
    const t = await keys()
    t.files.picked.push({ path: '/store/pick-1/sam.asc', name: 'sam.asc', size: 1, contentType: 'application/pgp-keys' })
    t.files.stored.set('/store/pick-1/sam.asc', encodeUtf8(sam.publicKey))
    await t.app.keys.pickFile()
    expect(t.shown().found).toHaveLength(1)
    expect(t.files.removed).toContain('/store/pick-1/sam.asc')
  })

  it('says that a text is no key', async () => {
    const t = await keys()
    await t.app.keys.scan('hello')
    expect(t.shown().error).toMatch(/kein Schlüssel/)
    expect(t.shown().found).toBeUndefined()
  })

  it('does nothing when no file is picked', async () => {
    const t = await keys()
    await t.app.keys.pickFile()
    expect(t.shown().found).toBeUndefined()
    expect(t.shown().error).toBeUndefined()
  })

  it('files a public key under the address it is taken for, and takes it off the list', async () => {
    const t = await keys()
    await t.app.keys.scan(sam.publicKey)
    await t.app.keys.adoptContact(sam.fingerprint, 'sam@example.net')
    expect((await contactKeysFor(t.db, 'sam@example.net')).map((key) => key.fingerprint)).toEqual([sam.fingerprint])
    expect(t.shown().found).toBeUndefined()
    expect(t.shown().contacts).toHaveLength(1)
  })

  it('leaves a key where it is when the user does not take it', async () => {
    const t = await keys()
    await t.app.keys.scan(`${sam.publicKey}\n${(await generateKeyPair('Kim', 'kim@example.net')).publicKey}`)
    expect(t.shown().found).toHaveLength(2)
    await t.app.keys.dismiss(sam.fingerprint)
    expect(t.shown().found?.map((key) => key.addresses[0])).toEqual(['kim@example.net'])
  })
})

describe('taking a private key', () => {
  it('gives it to the account it is for, open', async () => {
    const t = await keys()
    await t.app.keys.scan(sam.privateKey)
    await t.app.keys.adoptOwn(sam.fingerprint, t.work.id, '')
    const [taken] = await listOwnKeys(t.db, t.work.id)
    expect(taken.fingerprint).toBe(sam.fingerprint)
    expect(t.shown().found).toBeUndefined()
  })

  it('opens a key that is sealed with its passphrase, once, and keeps it open', async () => {
    const t = await keys()
    const sealed = (await openpgp.encryptKey({ privateKey: await openpgp.readPrivateKey({ armoredKey: sam.privateKey }), passphrase: 'correct horse' })).armor()
    await t.app.keys.scan(sealed)
    expect(t.shown().found?.[0].locked).toBe(true)
    await t.app.keys.adoptOwn(sam.fingerprint, t.work.id, 'correct horse')
    const [taken] = await listOwnKeys(t.db, t.work.id)
    expect((await openpgp.readPrivateKey({ armoredKey: taken.privateKey })).isDecrypted()).toBe(true)
  })

  it('says that a passphrase is wrong, or missing, and takes nothing', async () => {
    const t = await keys()
    const sealed = (await openpgp.encryptKey({ privateKey: await openpgp.readPrivateKey({ armoredKey: sam.privateKey }), passphrase: 'correct horse' })).armor()
    await t.app.keys.scan(sealed)
    await t.app.keys.adoptOwn(sam.fingerprint, t.work.id, 'wrong')
    expect(t.shown().error).toMatch(/Passwort stimmt nicht/)
    await t.app.keys.adoptOwn(sam.fingerprint, t.work.id, '')
    expect(t.shown().error).toMatch(/mit einem Passwort geschützt/)
    expect(await listOwnKeys(t.db, t.work.id)).toEqual([])
    expect(t.shown().found).toHaveLength(1)
  })
})

describe('letting go of a key and giving one away', () => {
  it('removes an own key, and a key of somebody else', async () => {
    const t = await keys()
    await t.app.keys.generate(t.work.id)
    const [own] = await listOwnKeys(t.db, t.work.id)
    await t.app.keys.scan(sam.publicKey)
    await t.app.keys.adoptContact(sam.fingerprint, 'sam@example.net')
    await t.app.keys.removeOwn(t.work.id, own.fingerprint)
    await t.app.keys.removeContact(sam.fingerprint)
    expect(await listOwnKeys(t.db, t.work.id)).toEqual([])
    expect(await contactKeysFor(t.db, 'sam@example.net')).toEqual([])
  })

  it('saves the public half of an own key as a file named for the address, and nothing of the private half', async () => {
    const t = await keys()
    await t.app.keys.generate(t.work.id)
    const [own] = await listOwnKeys(t.db, t.work.id)
    await t.app.keys.exportPublic(t.work.id, own.fingerprint)
    const [saved] = t.files.saved
    expect(saved.name).toBe(`${t.work.emailAddress}.asc`)
    const text = new TextDecoder().decode(saved.content)
    expect(text).toContain('PUBLIC KEY BLOCK')
    expect(text).not.toContain('PRIVATE')
  })

  it('says nothing when the user chose not to save', async () => {
    const t = await keys()
    await t.app.keys.generate(t.work.id)
    const [own] = await listOwnKeys(t.db, t.work.id)
    t.files.saveAnswer = false
    await t.app.keys.exportPublic(t.work.id, own.fingerprint)
    expect(t.shown().error).toBeUndefined()
  })
})
