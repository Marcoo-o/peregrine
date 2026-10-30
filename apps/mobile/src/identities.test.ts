import { describe, expect, it } from 'vitest'
import { addAccount, getAccount, removeAccount } from './accounts'
import {
  addIdentity,
  defaultIdentity,
  getIdentity,
  listAllIdentities,
  listIdentities,
  removeIdentity,
  setDefaultIdentity,
  updateIdentity
} from './identities'
import { account } from './testing/appHarness'
import { migratedDatabase } from './testing/testDb'

const input = (accountId: string, address: string, name = '') => ({ accountId, displayName: name, emailAddress: address, signature: '' })

describe('the identities of an account', () => {
  it('begin with the one the account has always had, as its default', async () => {
    const { db } = await migratedDatabase()
    const work = await addAccount(db, account('work'))
    expect(await listIdentities(db, work.id)).toEqual([
      { id: `${work.id}-default`, accountId: work.id, displayName: 'work', emailAddress: 'work@example.org', signature: '', isDefault: true, sortOrder: 0 }
    ])
    expect(await getAccount(db, work.id)).toBeDefined()
  })

  it('are added after it, and only the first is the default', async () => {
    const { db } = await migratedDatabase()
    const work = await addAccount(db, account('work'))
    const second = await addIdentity(db, input(work.id, 'info@example.org', 'Info'))
    expect(second).toMatchObject({ isDefault: false, sortOrder: 1 })
    expect((await listIdentities(db, work.id)).map((identity) => identity.emailAddress)).toEqual(['work@example.org', 'info@example.org'])
  })

  it('are kept apart from those of another account', async () => {
    const { db } = await migratedDatabase()
    const work = await addAccount(db, account('work'))
    const home = await addAccount(db, account('home'))
    await addIdentity(db, input(work.id, 'info@example.org'))
    expect(await listIdentities(db, home.id)).toHaveLength(1)
    expect(await listAllIdentities(db)).toHaveLength(3)
  })

  it('can be changed in name, address and signature, and are not found when they are not there', async () => {
    const { db } = await migratedDatabase()
    const work = await addAccount(db, account('work'))
    const changed = await updateIdentity(db, `${work.id}-default`, { displayName: 'Alex', signature: 'Best,\nAlex' })
    expect(changed).toMatchObject({ displayName: 'Alex', emailAddress: 'work@example.org', signature: 'Best,\nAlex' })
    expect(await getIdentity(db, `${work.id}-default`)).toEqual(changed)
    expect(await updateIdentity(db, 'nobody', { displayName: 'x' })).toBeUndefined()
    expect(await getIdentity(db, 'nobody')).toBeUndefined()
  })

  it('have one default, which is the first in the list', async () => {
    const { db } = await migratedDatabase()
    const work = await addAccount(db, account('work'))
    const second = await addIdentity(db, input(work.id, 'info@example.org'))
    await setDefaultIdentity(db, second.id)
    const listed = await listIdentities(db, work.id)
    expect(listed.map((identity) => [identity.emailAddress, identity.isDefault])).toEqual([
      ['info@example.org', true],
      ['work@example.org', false]
    ])
    expect((await defaultIdentity(db, work.id))?.id).toBe(second.id)
    await expect(setDefaultIdentity(db, 'nobody')).resolves.toBeUndefined()
  })

  it('can be removed, and the default passes to the next when it is the one that goes', async () => {
    const { db } = await migratedDatabase()
    const work = await addAccount(db, account('work'))
    const second = await addIdentity(db, input(work.id, 'info@example.org'))
    expect(await removeIdentity(db, `${work.id}-default`)).toBe(true)
    expect(await listIdentities(db, work.id)).toEqual([{ ...second, isDefault: true }])
  })

  it('keep the last one, which an account needs to send', async () => {
    const { db } = await migratedDatabase()
    const work = await addAccount(db, account('work'))
    expect(await removeIdentity(db, `${work.id}-default`)).toBe(false)
    expect(await removeIdentity(db, 'nobody')).toBe(false)
    expect(await listIdentities(db, work.id)).toHaveLength(1)
  })

  it('go with the account', async () => {
    const { db } = await migratedDatabase()
    const work = await addAccount(db, account('work'))
    await addIdentity(db, input(work.id, 'info@example.org'))
    await removeAccount(db, work.id)
    expect(await listAllIdentities(db)).toEqual([])
  })
})
