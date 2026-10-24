import { describe, expect, it } from 'vitest'
import { addAccount, removeAccount, type NewAccount } from '../accounts'
import { migratedDatabase } from '../testing/testDb'
import {
  contactKeysFor,
  listContactKeys,
  listOwnKeys,
  removeContactKey,
  removeOwnKey,
  saveContactKey,
  saveOwnKey,
  signingKey,
  type OwnKey
} from './keyStore'

const NEW_ACCOUNT: NewAccount = {
  displayName: 'Alex',
  emailAddress: 'alex@example.org',
  imapHost: 'imap.example.org',
  imapPort: 993,
  imapSecure: 'tls',
  imapUsername: 'alex',
  smtpHost: null,
  smtpPort: null,
  smtpSecure: null,
  smtpUsername: null,
  password: 'secret',
  smtpPassword: null
}

const own = (accountId: string, fingerprint: string, createdAt: number): OwnKey => ({
  fingerprint,
  accountId,
  publicKey: `public ${fingerprint}`,
  privateKey: `private ${fingerprint}`,
  createdAt
})

describe('the keys of an account', () => {
  it('are listed with the newest first, which is the one that signs', async () => {
    const { db } = await migratedDatabase()
    const account = await addAccount(db, NEW_ACCOUNT)
    await saveOwnKey(db, own(account.id, 'AAAA', 100))
    await saveOwnKey(db, own(account.id, 'BBBB', 200))
    expect((await listOwnKeys(db, account.id)).map((key) => key.fingerprint)).toEqual(['BBBB', 'AAAA'])
    expect((await signingKey(db, account.id))?.fingerprint).toBe('BBBB')
  })

  it('belong to their account only', async () => {
    const { db } = await migratedDatabase()
    const first = await addAccount(db, NEW_ACCOUNT)
    const second = await addAccount(db, { ...NEW_ACCOUNT, emailAddress: 'alex@example.net' })
    await saveOwnKey(db, own(first.id, 'AAAA', 100))
    expect(await listOwnKeys(db, second.id)).toEqual([])
    expect(await signingKey(db, second.id)).toBeUndefined()
  })

  it('are replaced and not doubled when the same key is saved again', async () => {
    const { db } = await migratedDatabase()
    const account = await addAccount(db, NEW_ACCOUNT)
    await saveOwnKey(db, own(account.id, 'AAAA', 100))
    await saveOwnKey(db, { ...own(account.id, 'AAAA', 100), privateKey: 'other' })
    const keys = await listOwnKeys(db, account.id)
    expect(keys).toHaveLength(1)
    expect(keys[0].privateKey).toBe('other')
  })

  it('can be removed one at a time', async () => {
    const { db } = await migratedDatabase()
    const account = await addAccount(db, NEW_ACCOUNT)
    await saveOwnKey(db, own(account.id, 'AAAA', 100))
    await saveOwnKey(db, own(account.id, 'BBBB', 200))
    await removeOwnKey(db, account.id, 'BBBB')
    expect((await listOwnKeys(db, account.id)).map((key) => key.fingerprint)).toEqual(['AAAA'])
  })

  it('go when the account goes, and the keys of other accounts stay', async () => {
    const { db } = await migratedDatabase()
    const first = await addAccount(db, NEW_ACCOUNT)
    const second = await addAccount(db, { ...NEW_ACCOUNT, emailAddress: 'alex@example.net' })
    await saveOwnKey(db, own(first.id, 'AAAA', 100))
    await saveOwnKey(db, own(second.id, 'BBBB', 100))
    await removeAccount(db, first.id)
    expect(await listOwnKeys(db, first.id)).toEqual([])
    expect(await listOwnKeys(db, second.id)).toHaveLength(1)
  })
})

describe('the keys of the people the user writes to', () => {
  it('are found by address without regard to case, the newest first', async () => {
    const { db } = await migratedDatabase()
    await saveContactKey(db, { fingerprint: 'AAAA', address: 'Sam@Example.NET', publicKey: 'old', createdAt: 100 })
    await saveContactKey(db, { fingerprint: 'BBBB', address: 'sam@example.net', publicKey: 'new', createdAt: 200 })
    const found = await contactKeysFor(db, ' SAM@example.net ')
    expect(found.map((key) => key.publicKey)).toEqual(['new', 'old'])
  })

  it('are none for an address that has no key', async () => {
    const { db } = await migratedDatabase()
    expect(await contactKeysFor(db, 'nobody@example.net')).toEqual([])
  })

  it('are listed all together and can be removed', async () => {
    const { db } = await migratedDatabase()
    await saveContactKey(db, { fingerprint: 'AAAA', address: 'b@example.net', publicKey: 'b', createdAt: 100 })
    await saveContactKey(db, { fingerprint: 'BBBB', address: 'a@example.net', publicKey: 'a', createdAt: 100 })
    expect((await listContactKeys(db)).map((key) => key.address)).toEqual(['a@example.net', 'b@example.net'])
    await removeContactKey(db, 'AAAA')
    expect((await listContactKeys(db)).map((key) => key.address)).toEqual(['a@example.net'])
  })
})
