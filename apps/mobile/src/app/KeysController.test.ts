import { beforeAll, describe, expect, it } from 'vitest'
import * as openpgp from 'openpgp'
import { encodeUtf8 } from '@peregrine/imap/utf8'
import { composeMessage } from '@peregrine/smtp/compose'
import { KeyLookupError } from '../pgp/keyLookup'
import { listAttachments } from '../attachments'
import { contactKeysFor, listOwnKeys } from '../pgp/keyStore'
import { generateKeyPair, scanKeys, type KeyPair } from '../pgp/pgpService'
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
    expect(saved.name).toBe(t.work.emailAddress)
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

describe('taking a key from a message', () => {
  const withKeyAttached = (content: string) =>
    composeMessage({
      from: 'sam@example.net',
      to: ['work@example.org'],
      subject: 'My key',
      text: 'Here it is.',
      attachments: [{ filename: 'sam.asc', contentType: 'application/pgp-keys', content: encodeUtf8(content) }]
    }).source

  it('shows what the attached file holds, to be placed, and stores nothing yet', async () => {
    const t = await keys()
    const source = withKeyAttached(sam.publicKey)
    const [attachment] = listAttachments(source)
    await t.app.keys.takeFrom(source, attachment)
    expect(t.shown().name).toBe('keys')
    expect(t.shown().found?.map((key) => key.addresses)).toEqual([['sam@example.net']])
    expect(await contactKeysFor(t.db, 'sam@example.net')).toEqual([])
  })

  it('says so when the file holds no key', async () => {
    const t = await keys()
    const source = withKeyAttached('nothing to see')
    const [attachment] = listAttachments(source)
    await t.app.keys.takeFrom(source, attachment)
    expect(t.shown().error).toMatch(/kein Schlüssel/)
  })

  it('says so when the message has no such part any more', async () => {
    const t = await keys()
    const [attachment] = listAttachments(withKeyAttached(sam.publicKey))
    await t.app.keys.takeFrom(undefined, attachment)
    expect(t.shown().error).toMatch(/nicht lesen/)
  })
})

describe('what the screen says of the state of the keys', () => {
  it('has the state of every key, own and of others', async () => {
    const t = await keys()
    await t.app.keys.generate(t.work.id)
    await t.app.keys.scan(sam.publicKey)
    await t.app.keys.adoptContact(sam.fingerprint, 'sam@example.net')
    const states = t.shown().states
    const [own] = await listOwnKeys(t.db, t.work.id)
    expect(states[own.fingerprint]).toMatchObject({ revoked: false, canEncrypt: true, canSign: true })
    expect(states[sam.fingerprint]).toMatchObject({ revoked: false, canEncrypt: true })
  })
})

describe('what the user wants of every message', () => {
  it('is shown and set from the keys screen', async () => {
    const t = await keys()
    expect(t.shown().defaults).toEqual({ sign: false, encrypt: false })
    await t.app.keys.setDefault('sign', true)
    expect(t.shown().defaults).toEqual({ sign: true, encrypt: false })
    await t.app.keys.setDefault('encrypt', true)
    expect(t.shown().defaults).toEqual({ sign: true, encrypt: true })
    await t.app.keys.setDefault('sign', false)
    expect(t.shown().defaults).toEqual({ sign: false, encrypt: true })
  })

  it('is read by the application when it starts, so that the first message already has it', async () => {
    const t = await keys()
    await t.app.keys.generate(t.work.id)
    await t.app.keys.setDefault('sign', true)
    expect(t.app.protection.forAccount(t.work.id)).toEqual({ sign: true })
  })
})

describe('looking for the key of an address', () => {
  it('shows what was found, said where it was found, and stores nothing yet', async () => {
    const t = await keys()
    const asked: string[] = []
    t.app.keys.lookup = async (address) => {
      asked.push(address)
      return { source: 'WKD', keys: await scanKeys(sam.publicKey) }
    }
    await t.app.keys.search(' sam@example.net ')
    expect(asked).toEqual(['sam@example.net'])
    expect(t.shown().found?.map((key) => key.addresses[0])).toEqual(['sam@example.net'])
    expect(t.shown().found?.[0].foundBy).toBe('Gefunden im Verzeichnis von example.net (WKD)')
    expect(await contactKeysFor(t.db, 'sam@example.net')).toEqual([])
  })

  it('says where the keyserver had it', async () => {
    const t = await keys()
    t.app.keys.lookup = async () => ({ source: 'keys.openpgp.org', keys: await scanKeys(sam.publicKey) })
    await t.app.keys.search('sam@example.net')
    expect(t.shown().found?.[0].foundBy).toBe('Gefunden auf keys.openpgp.org')
  })

  it('has the key placed like any other: for the address, when the user says so', async () => {
    const t = await keys()
    t.app.keys.lookup = async () => ({ source: 'WKD', keys: await scanKeys(sam.publicKey) })
    await t.app.keys.search('sam@example.net')
    await t.app.keys.adoptContact(sam.fingerprint, 'sam@example.net')
    expect((await contactKeysFor(t.db, 'sam@example.net')).map((key) => key.fingerprint)).toEqual([sam.fingerprint])
  })

  it('says what it asked when nothing is published, and that no server could be reached when none answered', async () => {
    const t = await keys()
    t.app.keys.lookup = async () => {
      throw new KeyLookupError('notFound')
    }
    await t.app.keys.search('sam@example.net')
    expect(t.shown().error).toMatch(/sam@example\.net ist kein Schlüssel veröffentlicht.*WKD.*keys\.openpgp\.org/)
    t.app.keys.lookup = async () => {
      throw new KeyLookupError('unreachable')
    }
    await t.app.keys.search('sam@example.net')
    expect(t.shown().error).toMatch(/nicht erreichen/)
  })

  it('says that it is no address, and does not hide what else was found', async () => {
    const t = await keys()
    await t.app.keys.scan(sam.publicKey)
    t.app.keys.lookup = async () => {
      throw new KeyLookupError('notAnAddress')
    }
    await t.app.keys.search('nobody')
    expect(t.shown().error).toMatch(/keine E-Mail-Adresse/)
    expect(t.shown().found).toHaveLength(1)
  })

  it('says why when it fails otherwise', async () => {
    const t = await keys()
    t.app.keys.lookup = async () => {
      throw new Error('boom')
    }
    await t.app.keys.search('sam@example.net')
    expect(t.shown().error).toMatch(/Die Suche ging schief/)
  })
})
