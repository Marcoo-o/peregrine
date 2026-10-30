import { describe, expect, it } from 'vitest'
import { listIdentities } from '../identities'
import { appHarness } from '../testing/appHarness'
import type { IdentitiesState } from './screens'

async function onSenders() {
  const t = await appHarness()
  const work = await t.givenAccount('work', {})
  await t.app.senders.show(work)
  const shown = () => t.store.screen as IdentitiesState
  const own = `${work.id}-default`
  return { ...t, work, shown, own }
}

describe('the screen for the senders of an account', () => {
  it('lists the identities with the default first', async () => {
    const t = await onSenders()
    expect(t.shown()).toMatchObject({ name: 'identities', identities: [{ id: t.own, isDefault: true }] })
  })

  it('goes back to the folders', async () => {
    const t = await onSenders()
    await t.app.senders.back(t.work)
    expect(t.store.screen).toMatchObject({ name: 'folders' })
  })

  it('makes a new identity, which the compose screen then offers', async () => {
    const t = await onSenders()
    await t.app.senders.save(t.shown(), null, { displayName: ' Info ', emailAddress: ' info@example.org ', signature: 'The desk\r\n' })
    expect(t.shown()).toMatchObject({ notice: 'Gespeichert.' })
    expect(t.shown().identities.map((identity) => [identity.displayName, identity.emailAddress, identity.signature])).toEqual([
      ['work', 'work@example.org', ''],
      ['Info', 'info@example.org', 'The desk']
    ])
    t.app.compose.startNew(t.work, t.store.screen)
    expect(t.store.screen).toMatchObject({ name: 'compose', identities: [{ id: t.own }, { emailAddress: 'info@example.org' }] })
  })

  it('changes one, and a new message then has its signature', async () => {
    const t = await onSenders()
    await t.app.senders.save(t.shown(), t.own, { displayName: 'Alex', emailAddress: 'work@example.org', signature: 'Alex' })
    t.app.compose.startNew(t.work, t.store.screen)
    expect(t.store.screen).toMatchObject({ draft: { body: '\n\n-- \nAlex' } })
  })

  it('refuses what is no address, and keeps nothing', async () => {
    const t = await onSenders()
    await t.app.senders.save(t.shown(), null, { displayName: 'x', emailAddress: 'not an address', signature: '' })
    expect(t.shown()).toMatchObject({ error: expect.stringContaining('keine E-Mail-Adresse') })
    expect(await listIdentities(t.db, t.work.id)).toHaveLength(1)
  })

  it('makes another the default, and a new message starts from it', async () => {
    const t = await onSenders()
    await t.app.senders.save(t.shown(), null, { displayName: 'Info', emailAddress: 'info@example.org', signature: '' })
    const info = t.shown().identities[1]
    await t.app.senders.makeDefault(t.shown(), info.id)
    expect(t.shown().identities[0].id).toBe(info.id)
    t.app.compose.startNew(t.work, t.store.screen)
    expect(t.store.screen).toMatchObject({ draft: { identityId: info.id } })
  })

  it('removes one, and refuses to remove the last', async () => {
    const t = await onSenders()
    await t.app.senders.remove(t.shown(), t.own)
    expect(t.shown()).toMatchObject({ error: expect.stringContaining('einzige Absender') })
    await t.app.senders.save(t.shown(), null, { displayName: 'Info', emailAddress: 'info@example.org', signature: '' })
    await t.app.senders.remove(t.shown(), t.own)
    expect(t.shown()).toMatchObject({ notice: 'Der Absender ist entfernt.', identities: [{ emailAddress: 'info@example.org', isDefault: true }] })
  })
})
