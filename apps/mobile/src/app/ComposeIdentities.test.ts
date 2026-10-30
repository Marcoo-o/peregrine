import { describe, expect, it } from 'vitest'
import { addIdentity, listIdentities, updateIdentity } from '../identities'
import { editFieldsOf } from './accountForm'
import { getAccount } from '../accounts'
import { appHarness } from '../testing/appHarness'
import { readable } from '../testing/readable'
import { emptyDraft } from '../draft'
import type { ComposeState, MessageState, Screen } from './screens'

const returnTo: Screen = { name: 'login' }

/** An account with its own identity, which has a signature, and a second one for another address. */
async function withIdentities() {
  const t = await appHarness()
  const work = await t.givenAccount('work', { INBOX: [], Trash: [], Sent: [], Drafts: [] })
  t.smtp.credentials = { user: 'work', pass: 'secret' }
  // The queue reaches the server of an account that is connected, which is what sending needs.
  await t.app.services.connections.ensure(work)
  const own = `${work.id}-default`
  await updateIdentity(t.db, own, { displayName: 'Alex', signature: 'Alex, Work' })
  const info = await addIdentity(t.db, { accountId: work.id, displayName: 'Info', emailAddress: 'info@example.org', signature: 'The info desk' })
  await t.app.identities.load()
  const shown = () => t.store.screen as ComposeState
  return { ...t, work, own, info, shown }
}

describe('starting a message from an identity', () => {
  it('is from the default identity of the account, with its signature under the text and room to type above it', async () => {
    const t = await withIdentities()
    t.app.compose.startNew(t.work, returnTo)
    expect(t.shown()).toMatchObject({ draft: { identityId: t.own, body: '\n\n-- \nAlex, Work' } })
    expect(t.shown().identities.map((identity) => identity.id)).toEqual([t.own, t.info.id])
  })

  it('has the signature under what an answer quotes, as the desktop has it', async () => {
    const t = await withIdentities()
    const message: MessageState = { name: 'message', account: t.work, folder: undefined as never, summary: undefined as never, origin: 'folder', message: readable() }
    t.app.compose.startReply(message)
    const body = t.shown().draft.body
    expect(body).toContain('> ')
    expect(body.endsWith('\n\n-- \nAlex, Work')).toBe(true)
  })

  it('has no signature for an identity that has none', async () => {
    const t = await withIdentities()
    await updateIdentity(t.db, t.own, { signature: '' })
    await t.app.identities.load()
    t.app.compose.startNew(t.work, returnTo)
    expect(t.shown().draft.body).toBe('')
  })

  it('comes from the identity of a draft that is written on again, and does not get a signature put under it', async () => {
    const t = await withIdentities()
    const message: MessageState = {
      name: 'message',
      account: t.work,
      folder: { id: 'f', accountId: t.work.id, imapPath: 'Drafts', displayName: 'Drafts', specialUse: '\\Drafts', parentPath: null },
      summary: { uid: 1 } as never,
      origin: 'folder',
      message: readable({ from: 'Info <info@example.org>', to: 'anna@example.net', text: 'Half written' })
    }
    await t.app.compose.startFromDraft(message)
    expect(t.shown().draft).toMatchObject({ identityId: t.info.id, body: 'Half written' })
  })
})

describe('sending from an identity', () => {
  it('says the identity is the sender, with its name, and not the account', async () => {
    const t = await withIdentities()
    t.app.compose.startNew(t.work, returnTo)
    const state = t.shown()
    const draft = { ...emptyDraft, identityId: t.info.id, to: 'anna@example.net', subject: 'Hi', body: 'Hello' }
    await t.app.compose.send(state, draft)
    const sent = t.smtp.message()
    expect(sent).toMatch(/^From: .*Info.*<info@example\.org>/m)
    expect(sent).not.toMatch(/^From: .*work@example\.org/m)
    expect(t.smtp.received.some((line) => line.startsWith('MAIL FROM'))).toBe(true)
  })

  it('is from the account itself for an identity that was taken away since, or that is another account’s', async () => {
    const t = await withIdentities()
    t.app.compose.startNew(t.work, returnTo)
    await t.app.compose.send(t.shown(), { ...emptyDraft, identityId: 'gone', to: 'anna@example.net', subject: 'Hi', body: 'Hello' })
    expect(t.smtp.message()).toMatch(/^From: .*<?work@example\.org>?/m)
  })
})

describe('an identity that goes with its account', () => {
  it('has the address of the account when that is changed, and keeps the name that was given by hand', async () => {
    const t = await withIdentities()
    const account = (await getAccount(t.db, t.work.id))!
    await t.app.accounts.save(account, { ...editFieldsOf(account), email: 'new@example.org', displayName: 'Work renamed' })
    const own = (await listIdentities(t.db, t.work.id)).find((identity) => identity.id === t.own)
    expect(own).toMatchObject({ emailAddress: 'new@example.org', displayName: 'Alex' })
    expect((await listIdentities(t.db, t.work.id)).find((identity) => identity.id === t.info.id)?.emailAddress).toBe('info@example.org')
    expect(t.app.identities.defaultFor(t.work.id)?.emailAddress).toBe('new@example.org')
  })
})
