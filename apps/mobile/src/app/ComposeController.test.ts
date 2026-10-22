import { describe, expect, it } from 'vitest'
import { listPendingActions } from '@peregrine/core/pendingActionsStore'
import { getAccount } from '../accounts'
import { listFolders } from '../folders'
import type { StoredMessage } from '../messages'
import { emptyDraft, type Draft } from '../draft'
import { appHarness, eventually } from '../testing/appHarness'
import { readable } from '../testing/readable'
import { senderProblem } from './ComposeController'
import type { ComposeState, MessageState, Screen } from './screens'

const returnTo: Screen = { name: 'login' }

async function composing() {
  const t = await appHarness()
  const work = await t.givenAccount('work', { INBOX: [], Trash: [], Sent: [], Drafts: [] })
  t.smtp.credentials = { user: 'work', pass: 'secret' }
  t.app.compose.startNew(work, returnTo)
  const state = t.store.screen as ComposeState
  const draft: Draft = { ...emptyDraft, to: 'anna@example.net', subject: 'Hi', body: 'Hello' }
  return { ...t, work, state, draft }
}

describe('who can send', () => {
  it('is an account with an address and a server for sending', async () => {
    const t = await appHarness()
    const work = await t.givenAccount('work', {})
    expect(senderProblem(work)).toBeNull()
  })

  it('says what is missing when there is no address or no server', async () => {
    const t = await appHarness()
    const noAddress = await t.givenAccount('a', {}, { emailAddress: '' })
    const noServer = await t.givenAccount('b', {}, { smtpHost: null })
    expect(senderProblem(noAddress)).toMatch(/keine Absenderadresse/)
    expect(senderProblem(noServer)).toMatch(/kein Server zum Senden/)
  })
})

describe('starting a message', () => {
  it('starts an empty one that goes back to where it was started from', async () => {
    const t = await composing()
    expect(t.state).toEqual({ name: 'compose', account: t.work, returnTo, draft: emptyDraft, busy: false })
  })

  it('starts an empty one from the first account where there is no account to start it from', async () => {
    const t = await appHarness()
    const first = await t.givenAccount('work', {})
    await t.givenAccount('home', {})
    await t.app.compose.startNewFromAnyAccount(returnTo)
    expect(t.store.screen).toMatchObject({ name: 'compose', account: { id: first.id }, returnTo })
  })

  it('starts nothing when there is no account at all', async () => {
    const t = await appHarness()
    const before = t.store.screen
    await t.app.compose.startNewFromAnyAccount(returnTo)
    expect(t.store.screen).toBe(before)
  })

  it('starts an answer that quotes the message, and goes back to the message', async () => {
    const t = await composing()
    const message: MessageState = {
      name: 'message',
      account: t.work,
      folder: undefined as never,
      summary: undefined as never,
      origin: 'folder',
      message: readable()
    }
    t.app.compose.startReply(message)
    const screen = t.store.screen as ComposeState
    expect(screen.draft).toMatchObject({ to: 'Anna <anna@example.net>', subject: 'Re: Lunch', inReplyTo: '<one@example.net>' })
    expect(screen.returnTo).toBe(message)
  })

  it('starts an answer to everybody that leaves the account itself out, and goes back to the message', async () => {
    const t = await composing()
    const message: MessageState = {
      name: 'message',
      account: t.work,
      folder: undefined as never,
      summary: undefined as never,
      origin: 'folder',
      message: readable({ to: `Alex <${t.work.emailAddress}>, Bob <bob@sender.test>`, cc: 'Cara <cara@sender.test>' })
    }
    t.app.compose.startReplyAll(message)
    const screen = t.store.screen as ComposeState
    expect(screen.draft).toMatchObject({
      to: 'Anna <anna@example.net>, Bob <bob@sender.test>',
      cc: 'Cara <cara@sender.test>',
      subject: 'Re: Lunch'
    })
    expect(screen.returnTo).toBe(message)
  })

  it('starts a message to be passed on, with nobody to send it to yet', async () => {
    const t = await composing()
    const message: MessageState = {
      name: 'message',
      account: t.work,
      folder: undefined as never,
      summary: undefined as never,
      origin: 'folder',
      message: readable()
    }
    t.app.compose.startForward(message)
    const screen = t.store.screen as ComposeState
    expect(screen.draft).toMatchObject({ to: '', subject: 'Fwd: Lunch' })
    expect(screen.draft.body).toContain('Weitergeleitete Nachricht')
    expect(screen.returnTo).toBe(message)
  })

  it('starts neither of them for a message whose text has not arrived', async () => {
    const t = await composing()
    const message = { name: 'message', account: t.work, origin: 'folder' } as unknown as MessageState
    const before = t.store.screen
    t.app.compose.startReplyAll(message)
    t.app.compose.startForward(message)
    expect(t.store.screen).toBe(before)
  })

  it('does not start an answer to a message whose text has not arrived', async () => {
    const t = await composing()
    t.store.showScreen(returnTo)
    t.app.compose.startReply({ name: 'message' } as MessageState)
    expect(t.store.screen).toBe(returnTo)
  })
})

describe('sending', () => {
  it('goes into the queue, which sends it when the account is connected, and goes back', async () => {
    const t = await composing()
    await t.app.services.connections.ensure(t.work)

    await t.app.compose.send(t.state, t.draft)

    expect(t.store.screen).toBe(returnTo)
    expect(t.smtp.messages).toHaveLength(1)
    expect(new TextDecoder().decode(t.smtp.messages[0])).toContain('Subject: Hi')
    expect(t.server.calls).toContain('append Sent')
  })

  it('waits in the queue when there is no connection, and goes back all the same', async () => {
    const t = await composing()
    await t.app.compose.send(t.state, t.draft)
    expect(t.store.screen).toBe(returnTo)
    expect(t.smtp.messages).toHaveLength(0)
    expect(await listPendingActions(t.db, t.work.id)).toHaveLength(1)
    await eventually(() => expect(t.store.state.waiting?.summary.total).toBe(1))
  })

  it('tells an account that cannot send before anything is queued, and stays', async () => {
    const t = await composing()
    const noServer = (await getAccount(t.db, t.work.id))!
    const state: ComposeState = { ...t.state, account: { ...noServer, smtpHost: null } }
    await t.app.compose.send(state, t.draft)
    expect(t.store.screen).toMatchObject({ name: 'compose', draft: t.draft, error: expect.stringContaining('kein Server') })
    expect(await listPendingActions(t.db, t.work.id)).toEqual([])
  })

  it('stays with the reason when it could not be queued, and is not busy any more', async () => {
    const t = await composing()
    t.app.services.mail.send = async () => {
      throw new Error('database is locked')
    }
    await t.app.compose.send(t.state, t.draft)
    expect(t.store.screen).toMatchObject({ name: 'compose', busy: false, error: 'database is locked' })
  })

  it('shows that it is busy while it is being queued', async () => {
    const t = await composing()
    const busy: boolean[] = []
    t.store.subscribe(() => {
      const screen = t.store.screen
      if (screen.name === 'compose') busy.push(screen.busy)
    })
    await t.app.compose.send(t.state, t.draft)
    expect(busy).toContain(true)
  })
})

describe('giving a message up', () => {
  it('goes back and removes the copies of what was attached', async () => {
    const t = await composing()
    const draft: Draft = {
      ...t.draft,
      attachments: [{ filename: 'a.txt', path: '/store/a', contentType: 'text/plain', size: 1 }]
    }
    await t.app.compose.cancel(t.state, draft)
    expect(t.files.removed).toEqual(['/store/a'])
    expect(t.store.screen).toBe(returnTo)
  })

  it('goes back even when the copies could not be removed', async () => {
    const t = await composing()
    t.files.remove = async () => {
      throw new Error('disk error')
    }
    await t.app.compose.cancel(t.state, {
      ...t.draft,
      attachments: [{ filename: 'a.txt', path: '/store/a', contentType: 'text/plain', size: 1 }]
    })
    expect(t.store.screen).toBe(returnTo)
  })
})

describe('drafts', () => {
  const crlf = (lines: string[]): string => lines.join('\r\n')
  const DRAFT = crlf(['From: work@example.org', 'To: Anna <anna@example.net>', 'Subject: Plan', '', 'Not finished', ''])

  /** An account with a draft on its server, and the screen of that draft as it is open. */
  async function withDraft(over: Partial<MessageState> = {}) {
    const t = await composing()
    const drafts = [{ uid: 7, subject: 'Plan', flags: ['\\Draft', '\\Seen'], source: DRAFT }]
    const work = await t.givenAccount('draftsman', { INBOX: [], Trash: [], Sent: [], Drafts: drafts })
    const folder = t.folderOf(await listFolders(t.db, work.id), 'Drafts')
    const message: MessageState = {
      name: 'message',
      account: work,
      folder,
      summary: { uid: 7 } as StoredMessage,
      origin: 'folder',
      message: readable({ to: 'Anna <anna@example.net>', subject: 'Plan', text: 'Not finished', html: null }),
      attachments: [],
      ...over
    }
    t.smtp.credentials = { user: 'draftsman', pass: 'secret' }
    return { ...t, work, folder, message }
  }

  it('can be written on, and sending or saving it replaces the revision it was opened from', async () => {
    const t = await withDraft()
    t.app.compose.startFromDraft(t.message)
    expect(t.store.screen).toMatchObject({
      name: 'compose',
      draft: { to: 'Anna <anna@example.net>', subject: 'Plan', body: 'Not finished' },
      saved: { uid: 7 },
      returnTo: t.message
    })
  })

  it('is not opened when saving it again would lose something, and says why on the message', async () => {
    const t = await withDraft({ attachments: [{ filename: 'a.txt', contentType: 'text/plain', size: 1, partId: '2' } as never] })
    t.app.compose.startFromDraft(t.message)
    expect(t.store.screen).toMatchObject({ name: 'message', notice: expect.stringContaining('Anhänge') })
  })

  it('is not opened before its text has arrived', async () => {
    const t = await withDraft({ message: undefined })
    const before = t.store.screen
    t.app.compose.startFromDraft(t.message)
    expect(t.store.screen).toBe(before)
  })

  it('is kept on the server by a new message, which goes back to where it was started', async () => {
    const t = await composing()
    const work = (await getAccount(t.db, t.work.id))!
    await t.app.compose.saveDraft({ ...t.state, account: work }, t.draft)
    expect(t.server.calls).toContain('append Drafts')
    expect(t.server.calls.some((call) => call.startsWith('delete'))).toBe(false)
    expect(t.store.screen).toBe(returnTo)
  })

  it('replaces the revision it was opened from and goes to the drafts', async () => {
    const t = await withDraft()
    t.app.compose.startFromDraft(t.message)
    const state = t.store.screen as ComposeState
    t.server.calls.length = 0

    await t.app.compose.saveDraft(state, { ...state.draft, body: 'Finished' })

    const calls = t.server.calls
    expect(calls).toContain('append Drafts')
    await eventually(() => expect(t.server.calls).toContain('delete Drafts 7'))
    expect(calls.indexOf('append Drafts')).toBeLessThan(calls.indexOf('delete Drafts 7'))
    expect(t.store.screen).toMatchObject({ name: 'messages', folder: { imapPath: 'Drafts' } })
  })

  it('stays, with the reason, when there is no connection to keep it on, and keeps the message', async () => {
    const t = await composing()
    t.server.unreachable.add('work')
    await t.app.compose.saveDraft(t.state, t.draft)
    expect(t.store.screen).toMatchObject({
      name: 'compose',
      busy: false,
      draft: t.draft,
      error: expect.stringContaining('nicht erreichbar')
    })
    expect(t.files.removed).toEqual([])
  })

  it('does not drop the old revision when the new one could not be kept', async () => {
    const t = await withDraft()
    t.app.compose.startFromDraft(t.message)
    const state = t.store.screen as ComposeState
    t.server.unreachable.add('draftsman')
    t.server.calls.length = 0
    await t.app.compose.saveDraft(state, state.draft)
    expect(t.server.calls.some((call) => call.startsWith('delete'))).toBe(false)
    expect(t.store.screen).toMatchObject({ name: 'compose', error: expect.any(String) })
  })

  it('takes the attached files to the server with it, and removes the copies once the server has them', async () => {
    const t = await composing()
    t.files.stored.set('/store/a', new TextEncoder().encode('attached'))
    const draft: Draft = {
      ...t.draft,
      attachments: [{ filename: 'a.txt', path: '/store/a', contentType: 'text/plain', size: 8 }]
    }
    await t.app.compose.saveDraft(t.state, draft)
    expect(t.server.calls).toContain('append Drafts')
    expect(t.files.removed).toEqual(['/store/a'])
    expect(t.store.screen).toBe(returnTo)
  })

  it('is removed from the folder when its sending was queued', async () => {
    const t = await withDraft()
    t.app.compose.startFromDraft(t.message)
    const state = t.store.screen as ComposeState
    await t.app.services.connections.ensure(state.account)
    t.server.calls.length = 0

    await t.app.compose.send(state, state.draft)

    await eventually(() => expect(t.server.calls).toContain('delete Drafts 7'))
    expect(t.store.screen).toMatchObject({ name: 'messages', folder: { imapPath: 'Drafts' } })
  })

  it('stays as it was when it is given up, and goes to the drafts', async () => {
    const t = await withDraft()
    t.app.compose.startFromDraft(t.message)
    const state = t.store.screen as ComposeState
    t.server.calls.length = 0
    await t.app.compose.cancel(state, state.draft)
    expect(t.server.calls.some((call) => call.startsWith('delete'))).toBe(false)
    expect(t.store.screen).toMatchObject({ name: 'messages', folder: { imapPath: 'Drafts' } })
  })
})

describe('suggesting who to write to', () => {
  it('suggests the people the phone has mail from, and not the accounts of the user', async () => {
    const t = await appHarness()
    await t.givenAccount('work', { INBOX: [{ uid: 1 }, { uid: 2 }] }, { emailAddress: 'sender@example.net' })
    await t.givenAccount('home', { INBOX: [{ uid: 1 }] })
    // Every message of the fake server is from sender@example.net, which is one of the user's own addresses here.
    expect(await t.app.compose.suggest('sender')).toEqual([])
  })

  it('suggests an address that the user does not have', async () => {
    const t = await appHarness()
    await t.givenAccount('work', { INBOX: [{ uid: 1 }, { uid: 2 }] })
    expect(await t.app.compose.suggest('SENDER@')).toEqual([{ name: '', address: 'sender@example.net' }])
    expect(await t.app.compose.suggest('nobody')).toEqual([])
  })
})
