import { describe, expect, it } from 'vitest'
import { listPendingActions } from '@peregrine/core/pendingActionsStore'
import { getAccount } from '../accounts'
import { listAttachments } from '../attachments'
import { listFolders } from '../folders'
import type { StoredMessage } from '../messages'
import { emptyDraft, isChanged, type Draft } from '../draft'
import { saveListSettings } from '../settings'
import { appHarness, eventually } from '../testing/appHarness'
import { saveOwnKey } from '../pgp/keyStore'
import { generateKeyPair } from '../pgp/pgpService'
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

describe('starting a message with what the user wants of every message', () => {
  async function withKey(on: { sign?: boolean; encrypt?: boolean }) {
    const t = await composing()
    const own = await generateKeyPair('Work', 'work@example.org')
    await saveOwnKey(t.db, { fingerprint: own.fingerprint, accountId: t.work.id, publicKey: own.publicKey, privateKey: own.privateKey, createdAt: 1 })
    await t.app.protection.change(on)
    await t.app.protection.load()
    return t
  }

  it('is signed and encrypted from the start where both are wanted and the account has a key', async () => {
    const t = await withKey({ sign: true, encrypt: true })
    t.app.compose.startNew(t.work, returnTo)
    expect((t.store.screen as ComposeState).draft).toMatchObject({ sign: true, encrypt: true })
  })

  it('starts an answer in the same way', async () => {
    const t = await withKey({ sign: true })
    const message: MessageState = {
      name: 'message',
      account: t.work,
      folder: undefined as never,
      summary: undefined as never,
      origin: 'folder',
      message: readable()
    }
    t.app.compose.startReply(message)
    expect((t.store.screen as ComposeState).draft).toMatchObject({ sign: true })
    expect((t.store.screen as ComposeState).draft.encrypt).toBeUndefined()
  })

  it('is as it would have been for an account without a key', async () => {
    const t = await composing()
    await t.app.protection.change({ sign: true, encrypt: true })
    await t.app.protection.load()
    t.app.compose.startNew(t.work, returnTo)
    expect((t.store.screen as ComposeState).draft).toEqual(emptyDraft)
  })

  it('does not count as a change that has to be kept: leaving it as it started loses nothing', async () => {
    const t = await withKey({ sign: true })
    t.app.compose.startNew(t.work, returnTo)
    const state = t.store.screen as ComposeState
    expect(isChanged(state.draft, state.draft)).toBe(false)
  })
})

describe('starting a message', () => {
  it('starts an empty one that goes back to where it was started from', async () => {
    const t = await composing()
    expect(t.state).toEqual({ name: 'compose', session: expect.any(String), account: t.work, returnTo, draft: emptyDraft, busy: false })
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
    await t.app.compose.startForward(message)
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
    await t.app.compose.startForward(message)
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

  it('sends a blind copy to its address and tells nobody else of it', async () => {
    const t = await composing()
    await t.app.services.connections.ensure(t.work)

    await t.app.compose.send(t.state, { ...t.draft, bcc: 'Carl <carl@example.net>' })

    const recipients = t.smtp.received.filter((line) => line.startsWith('RCPT'))
    expect(recipients.some((line) => line.includes('carl@example.net'))).toBe(true)
    expect(recipients.some((line) => line.includes('anna@example.net'))).toBe(true)
    const sent = new TextDecoder().decode(t.smtp.messages[0])
    expect(sent).not.toContain('carl@example.net')
    expect(sent).not.toMatch(/^Bcc:/im)
  })

  it('can go to nobody but a blind copy', async () => {
    const t = await composing()
    await t.app.services.connections.ensure(t.work)
    await t.app.compose.send(t.state, { ...t.draft, to: '', bcc: 'carl@example.net' })
    expect(t.smtp.messages).toHaveLength(1)
    expect(t.smtp.received.some((line) => line.startsWith('RCPT') && line.includes('carl@example.net'))).toBe(true)
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

  it('tells a message that is to be encrypted what is missing before anything is queued, and stays', async () => {
    const t = await composing()
    await t.app.compose.send(t.state, { ...t.draft, encrypt: true })
    expect(t.store.screen).toMatchObject({ name: 'compose', error: expect.stringContaining('keinen Schlüssel') })
    expect(await listPendingActions(t.db, t.work.id)).toEqual([])
    expect(t.smtp.messages).toEqual([])
  })

  it('names the recipients without a key when the account has its own', async () => {
    const t = await composing()
    const own = await generateKeyPair('Work', 'work@example.org')
    await saveOwnKey(t.db, { fingerprint: own.fingerprint, accountId: t.work.id, publicKey: own.publicKey, privateKey: own.privateKey, createdAt: 1 })
    await t.app.compose.send(t.state, { ...t.draft, encrypt: true })
    expect(t.store.screen).toMatchObject({ name: 'compose', error: expect.stringContaining('anna@example.net') })
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
    await t.app.compose.startFromDraft(t.message)
    expect(t.store.screen).toMatchObject({
      name: 'compose',
      draft: { to: 'Anna <anna@example.net>', subject: 'Plan', body: 'Not finished' },
      saved: { uid: 7 },
      returnTo: t.message
    })
  })

  it('is written on encrypted when it was kept encrypted, and signed when it was kept signed', async () => {
    const encrypted = await withDraft({ protection: 'encrypted-unverified' })
    await encrypted.app.compose.startFromDraft(encrypted.message)
    expect((encrypted.store.screen as ComposeState).draft).toMatchObject({ encrypt: true })
    expect((encrypted.store.screen as ComposeState).draft.sign).toBeUndefined()

    const signed = await withDraft({ protection: 'signed-verified' })
    await signed.app.compose.startFromDraft(signed.message)
    expect((signed.store.screen as ComposeState).draft).toMatchObject({ sign: true })
    expect((signed.store.screen as ComposeState).draft.encrypt).toBeUndefined()
  })

  it('is not opened when it has a formatting that cannot be written, and says why on the message', async () => {
    const t = await withDraft({ message: readable({ to: 'Anna <anna@example.net>', subject: 'Plan', text: 'x', html: '<p>x</p>' }) })
    await t.app.compose.startFromDraft(t.message)
    expect(t.store.screen).toMatchObject({ name: 'message', notice: expect.stringContaining('Formatierung') })
  })

  it('is not opened before its text has arrived', async () => {
    const t = await withDraft({ message: undefined })
    const before = t.store.screen
    await t.app.compose.startFromDraft(t.message)
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
    await t.app.compose.startFromDraft(t.message)
    const state = t.store.screen as ComposeState
    t.server.calls.length = 0

    await t.app.compose.saveDraft(state, { ...state.draft, body: 'Finished' })

    const calls = t.server.calls
    expect(calls).toContain('append Drafts')
    await eventually(() => expect(t.server.calls).toContain('delete Drafts 7'))
    expect(calls.indexOf('append Drafts')).toBeLessThan(calls.indexOf('delete Drafts 7'))
    expect(t.store.screen).toMatchObject({ name: 'messages', folder: { imapPath: 'Drafts' } })
  })

  it('waits in the queue when there is no connection to keep it on, and leaves all the same', async () => {
    const t = await composing()
    t.server.unreachable.add('work')
    await t.app.compose.saveDraft(t.state, t.draft)
    expect(t.store.screen).toBe(returnTo)
    expect(await listPendingActions(t.db, t.work.id)).toMatchObject([{ kind: 'saveDraft' }])
  })

  it('keeps the files of a draft that waits, which carries them, and keeps the draft when the connection comes', async () => {
    const t = await composing()
    t.files.stored.set('/store/a', new TextEncoder().encode('attached'))
    const draft: Draft = {
      ...t.draft,
      attachments: [{ filename: 'a.txt', path: '/store/a', contentType: 'text/plain', size: 8 }]
    }
    t.server.unreachable.add('work')
    await t.app.compose.saveDraft(t.state, draft)
    expect(t.files.removed).toEqual([])

    t.server.unreachable.delete('work')
    await t.app.services.connections.ensure(t.work)
    await t.app.services.mail.flush(t.work.id)
    expect(t.server.calls).toContain('append Drafts')
    expect(await listPendingActions(t.db, t.work.id)).toEqual([])
  })

  it('does not drop the old revision while the new one could not be kept, and does when it is', async () => {
    const t = await withDraft()
    await t.app.compose.startFromDraft(t.message)
    const state = t.store.screen as ComposeState
    t.server.unreachable.add('draftsman')
    t.server.calls.length = 0
    await t.app.compose.saveDraft(state, state.draft)
    expect(t.server.calls.some((call) => call.startsWith('delete'))).toBe(false)
    expect(t.store.screen).toMatchObject({ name: 'messages' })

    t.server.unreachable.delete('draftsman')
    await t.app.services.connections.ensure(state.account)
    await t.app.services.mail.flush(state.account.id)
    expect(t.server.calls).toContain('append Drafts')
    await eventually(() => expect(t.server.calls).toContain('delete Drafts 7'))
    expect(t.server.calls.indexOf('append Drafts')).toBeLessThan(t.server.calls.indexOf('delete Drafts 7'))
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
    await t.app.compose.startFromDraft(t.message)
    const state = t.store.screen as ComposeState
    await t.app.services.connections.ensure(state.account)
    t.server.calls.length = 0

    await t.app.compose.send(state, state.draft)

    await eventually(() => expect(t.server.calls).toContain('delete Drafts 7'))
    expect(t.store.screen).toMatchObject({ name: 'messages', folder: { imapPath: 'Drafts' } })
  })

  it('stays as it was when it is given up, and goes to the drafts', async () => {
    const t = await withDraft()
    await t.app.compose.startFromDraft(t.message)
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

  describe('from the address book of the device', () => {
    const people = [
      { name: 'Kim Example', address: 'kim@example.net' },
      { name: 'Sender Person', address: 'SENDER@example.net' },
      { name: 'Alex Own', address: 'work@example.org' }
    ]

    async function withBook(on: boolean, allowed: boolean) {
      const t = await appHarness()
      await t.givenAccount('work', { INBOX: [{ uid: 1 }] })
      t.deviceContacts.people = people
      t.deviceContacts.allowed = allowed
      await saveListSettings(t.db, { deviceContacts: on })
      return t
    }

    it('are suggested after the people the phone has mail from, each address once, with the name the address book has', async () => {
      const t = await withBook(true, true)
      expect(await t.app.compose.suggest('e')).toEqual([
        { name: 'Sender Person', address: 'sender@example.net' },
        { name: 'Kim Example', address: 'kim@example.net' }
      ])
    })

    it('do not include the accounts of the user', async () => {
      const t = await withBook(true, true)
      expect((await t.app.compose.suggest('own')).map((contact) => contact.address)).toEqual([])
    })

    it('are not asked for while the switch is off, or the system does not allow it', async () => {
      expect(await (await withBook(false, true)).app.compose.suggest('kim')).toEqual([])
      expect(await (await withBook(true, false)).app.compose.suggest('kim')).toEqual([])
    })

    it('leave the people of the mail when the address book cannot be read, and say so', async () => {
      const t = await withBook(true, true)
      t.deviceContacts.search = async () => {
        throw new Error('no provider')
      }
      expect(await t.app.compose.suggest('sender')).toEqual([{ name: '', address: 'sender@example.net' }])
      expect(t.logs.some((line) => line.includes('no provider'))).toBe(true)
    })
  })
})

describe('keeping a message as a draft by itself', () => {
  const written = (t: Awaited<ReturnType<typeof composing>>, body = 'Hello') => ({ ...t.draft, body })
  const shown = (t: { store: { screen: Screen } }) => t.store.screen as ComposeState

  it('keeps what was written in the drafts folder, stays on the screen, and says when', async () => {
    const t = await composing()
    await t.app.compose.autosave(t.state, written(t))
    expect(t.server.calls).toContain('append Drafts')
    expect(shown(t)).toMatchObject({
      name: 'compose',
      saved: { uid: 1 },
      savedDraft: { body: 'Hello' },
      autosave: { status: 'saved', at: expect.any(Number) }
    })
  })

  it('keeps nothing for a message that is as it was when it began, or as it was when it was last kept', async () => {
    const t = await composing()
    await t.app.compose.autosave(t.state, t.state.draft)
    expect(t.server.calls).not.toContain('append Drafts')

    await t.app.compose.autosave(t.state, written(t))
    await t.app.compose.autosave(shown(t), written(t))
    expect(t.server.calls.filter((call) => call === 'append Drafts')).toHaveLength(1)
  })

  it('replaces the revision kept before with the new one: it is appended first and the old one is deleted after', async () => {
    const t = await composing()
    await t.app.compose.autosave(t.state, written(t, 'One'))
    t.server.calls.length = 0
    await t.app.compose.autosave(shown(t), written(t, 'Two'))
    await eventually(() => expect(t.server.calls).toContain('delete Drafts 1'))
    expect(t.server.calls.indexOf('append Drafts')).toBeLessThan(t.server.calls.indexOf('delete Drafts 1'))
    expect(shown(t).savedDraft?.body).toBe('Two')
  })

  it('says that it waits when there is no connection, writes on, and has it kept once there is one', async () => {
    const t = await composing()
    t.server.unreachable.add('work')
    await t.app.compose.autosave(t.state, written(t))
    expect(shown(t)).toMatchObject({ autosave: { status: 'waiting' } })
    expect(shown(t).saved).toBeUndefined()

    t.server.unreachable.delete('work')
    await t.app.services.connections.ensure(t.work)
    await t.app.services.mail.flush(t.work.id)
    expect(shown(t)).toMatchObject({ saved: { uid: 1 }, autosave: { status: 'saved' } })
    expect(shown(t).savedDraft?.body).toBe(written(t).body)
  })

  it('keeps one draft of a message that was changed twice without a connection, the last as it was written', async () => {
    const t = await composing()
    t.server.unreachable.add('work')
    await t.app.compose.autosave(t.state, written(t, 'One'))
    await t.app.compose.autosave(shown(t), written(t, 'Two'))
    expect(await listPendingActions(t.db, t.work.id)).toHaveLength(1)

    t.server.unreachable.delete('work')
    await t.app.services.connections.ensure(t.work)
    await t.app.services.mail.flush(t.work.id)
    expect(t.server.calls.filter((call) => call === 'append Drafts')).toHaveLength(1)
    expect(shown(t).savedDraft?.body).toBe('Two')
  })

  it('takes a draft that waits out of the queue when the message is sent or thrown away', async () => {
    const t = await composing()
    t.server.unreachable.add('work')
    await t.app.compose.autosave(t.state, written(t))
    await t.app.compose.discard(shown(t), written(t))
    expect(await listPendingActions(t.db, t.work.id)).toEqual([])
  })

  it('says so when the account has no folder for drafts', async () => {
    const t = await appHarness()
    const work = await t.givenAccount('work', { INBOX: [], Trash: [], Sent: [] })
    t.app.compose.startNew(work, returnTo)
    await t.app.compose.autosave(shown(t), { ...emptyDraft, body: 'Hello' })
    expect(shown(t)).toMatchObject({ autosave: { status: 'failed', error: expect.stringContaining('keinen Ordner für Entwürfe') } })
  })

  it('does not keep a draft in the clear that was meant to be encrypted, and says why', async () => {
    const t = await composing()
    await t.app.compose.autosave(shown(t), { ...emptyDraft, body: 'Hello', encrypt: true })
    expect(shown(t)).toMatchObject({ autosave: { status: 'failed', error: expect.stringContaining('keinen Schlüssel') } })
    expect(await listPendingActions(t.db, t.work.id)).toEqual([])
  })

  it('stops keeping by itself when the server does not say where it put the draft, so that there are not two', async () => {
    const t = await composing()
    await t.app.services.connections.ensure(t.work)
    for (const session of t.server.sessions) session.appendMessage = async () => null as never
    await t.app.compose.autosave(t.state, written(t))
    expect(shown(t)).toMatchObject({ noAutosave: true, autosave: { status: 'saved' } })
    expect(shown(t).saved).toBeUndefined()
    t.server.calls.length = 0
    await t.app.compose.autosave(shown(t), written(t, 'More'))
    expect(t.server.calls).toEqual([])
  })

  it('puts nothing on a screen that is not the writing of this message any more', async () => {
    const t = await composing()
    const pending = t.app.compose.autosave(t.state, written(t))
    t.store.showScreen(returnTo)
    await pending
    expect(t.store.screen).toBe(returnTo)
  })

  it('is waited for by sending, which then deletes the draft that was kept and goes back to where it began', async () => {
    const t = await composing()
    await t.app.services.connections.ensure(t.work)
    const pending = t.app.compose.autosave(t.state, written(t))
    await t.app.compose.send(t.state, written(t))
    await pending
    await eventually(() => expect(t.server.calls).toContain('delete Drafts 1'))
    expect(t.store.screen).toBe(returnTo)
    expect(t.smtp.messages).toHaveLength(1)
  })

  it('is replaced by keeping it by hand, which leaves for where the message began', async () => {
    const t = await composing()
    await t.app.compose.autosave(t.state, written(t))
    t.server.calls.length = 0
    await t.app.compose.saveDraft(shown(t), written(t, 'Final'))
    await eventually(() => expect(t.server.calls).toContain('delete Drafts 1'))
    expect(t.store.screen).toBe(returnTo)
  })

  it('stays when the writing is left, which keeps the message where it was kept', async () => {
    const t = await composing()
    await t.app.compose.autosave(t.state, written(t))
    t.server.calls.length = 0
    await t.app.compose.cancel(shown(t), written(t))
    expect(t.store.screen).toBe(returnTo)
    expect(t.server.calls.some((call) => call.startsWith('delete'))).toBe(false)
  })
})

describe('throwing a message away', () => {
  it('deletes the draft that was kept of it, and goes back to where it began', async () => {
    const t = await composing()
    await t.app.compose.autosave(t.state, { ...t.draft, body: 'Hello' })
    t.server.calls.length = 0
    await t.app.compose.discard(t.store.screen as ComposeState, t.draft)
    await eventually(() => expect(t.server.calls).toContain('delete Drafts 1'))
    expect(t.store.screen).toBe(returnTo)
  })

  it('deletes nothing for a message that was never kept', async () => {
    const t = await composing()
    await t.app.compose.discard(t.state, t.draft)
    expect(t.server.calls.some((call) => call.startsWith('delete'))).toBe(false)
    expect(t.store.screen).toBe(returnTo)
  })

  it('takes a draft that was opened with it, as the desktop does, and shows the drafts', async () => {
    const t = await composing()
    const crlf = String.fromCharCode(13, 10)
    const work = await t.givenAccount('draftsman', {
      INBOX: [],
      Drafts: [{ uid: 7, subject: 'Plan', source: ['From: a@example.org', 'To: b@example.net', 'Subject: Plan', '', 'Text', ''].join(crlf) }]
    })
    const folder = t.folderOf(await listFolders(t.db, work.id), 'Drafts')
    const message: MessageState = {
      name: 'message',
      account: work,
      folder,
      summary: { uid: 7 } as StoredMessage,
      origin: 'folder',
      message: readable({ to: 'b@example.net', subject: 'Plan', text: 'Text', html: null }),
      attachments: []
    }
    await t.app.compose.startFromDraft(message)
    await t.app.services.connections.ensure(work)
    t.server.calls.length = 0
    await t.app.compose.discard(t.store.screen as ComposeState, (t.store.screen as ComposeState).draft)
    await eventually(() => expect(t.server.calls).toContain('delete Drafts 7'))
    expect(t.store.screen).toMatchObject({ name: 'messages', folder: { imapPath: 'Drafts' } })
  })
})

/** A message with a text and the files attached to it, as source, the way a mail program makes one. */
function withFiles(files: Array<{ name: string; text: string; type?: string }>): Uint8Array {
  const eol = String.fromCharCode(13, 10)
  const lines = [
    'From: work@example.org',
    'To: Anna <anna@example.net>',
    'Subject: Plan',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="b"',
    '',
    '--b',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Not finished',
    ...files.flatMap((file) => [
      '--b',
      `Content-Type: ${file.type ?? 'text/plain'}; name="${file.name}"`,
      `Content-Disposition: attachment; filename="${file.name}"`,
      'Content-Transfer-Encoding: base64',
      '',
      btoa(file.text),
      ''
    ]),
    '--b--',
    ''
  ]
  return new TextEncoder().encode(lines.join(eol))
}

describe('the attachments of a message that is written on again or passed on', () => {
  async function onMessage(files: Array<{ name: string; text: string; type?: string }>) {
    const t = await composing()
    const source = withFiles(files)
    const message: MessageState = {
      name: 'message',
      account: t.work,
      folder: undefined as never,
      summary: { uid: 7 } as StoredMessage,
      origin: 'folder',
      message: readable({ to: 'Anna <anna@example.net>', subject: 'Plan', text: 'Not finished', html: null }),
      source,
      attachments: listAttachments(source)
    }
    return { ...t, message }
  }

  it('go along with a message that is passed on, as files of the new message', async () => {
    const t = await onMessage([
      { name: 'notes.txt', text: 'hello' },
      { name: 'plan.csv', text: 'a,b', type: 'text/csv' }
    ])
    await t.app.compose.startForward(t.message)
    const screen = t.store.screen as ComposeState
    expect(screen.name).toBe('compose')
    expect(screen.draft.attachments).toMatchObject([
      { filename: 'notes.txt', contentType: 'text/plain', size: 5 },
      { filename: 'plan.csv', contentType: 'text/csv', size: 3 }
    ])
    expect(screen.error).toBeUndefined()
    expect(new TextDecoder().decode(t.files.stored.get(screen.draft.attachments[0].path))).toBe('hello')
  })

  it('are put on a message that is passed on, and can be taken off like any attached file', async () => {
    const t = await onMessage([{ name: 'notes.txt', text: 'hello' }])
    await t.app.compose.startForward(t.message)
    const screen = t.store.screen as ComposeState
    const path = screen.draft.attachments[0].path
    await t.app.compose.cancel(screen, screen.draft)
    expect(t.files.removed).toContain(path)
  })

  it('are not there for a message that has none, and nothing is copied', async () => {
    const t = await onMessage([])
    await t.app.compose.startForward(t.message)
    expect((t.store.screen as ComposeState).draft.attachments).toEqual([])
    expect(t.files.stashed).toEqual([])
  })

  it('say what could not go along with a message that is passed on, and the rest does', async () => {
    const t = await onMessage([{ name: 'notes.txt', text: 'hello' }])
    t.message.attachments = [...t.message.attachments!, { id: '9', filename: 'gone.bin', originalName: null, contentType: 'application/octet-stream', size: 1, findings: [] }]
    await t.app.compose.startForward(t.message)
    const screen = t.store.screen as ComposeState
    expect(screen.draft.attachments.map((file) => file.filename)).toEqual(['notes.txt'])
    expect(screen.error).toContain('gone.bin')
  })

  it('stay on the message, with the reason, when they cannot be copied, and no copy is left', async () => {
    const t = await onMessage([{ name: 'notes.txt', text: 'hello' }])
    t.files.failWith = new Error('disk full')
    await t.app.compose.startForward(t.message)
    expect(t.store.screen).toMatchObject({ name: 'message', notice: expect.stringContaining('disk full') })
  })

  it('are in a draft that is written on again, which is not changed by having them', async () => {
    const t = await onMessage([{ name: 'notes.txt', text: 'hello' }])
    await t.app.compose.startFromDraft(t.message)
    const screen = t.store.screen as ComposeState
    expect(screen.name).toBe('compose')
    expect(screen.draft.attachments).toHaveLength(1)
    expect(screen.savedDraft).toEqual(screen.draft)
  })

  it('keep a draft from being opened when not all of them can be taken over, and the copies made are removed', async () => {
    const t = await onMessage([{ name: 'notes.txt', text: 'hello' }])
    t.message.attachments = [...t.message.attachments!, { id: '9', filename: 'gone.bin', originalName: null, contentType: 'application/octet-stream', size: 1, findings: [] }]
    await t.app.compose.startFromDraft(t.message)
    expect(t.store.screen).toMatchObject({ name: 'message', notice: expect.stringContaining('gone.bin') })
    expect(t.files.removed).toContain(t.files.stashed[0].path)
  })

  it('keep a draft from being opened when they cannot be copied, with the reason', async () => {
    const t = await onMessage([{ name: 'notes.txt', text: 'hello' }])
    t.files.failWith = new Error('disk full')
    await t.app.compose.startFromDraft(t.message)
    expect(t.store.screen).toMatchObject({ name: 'message', notice: expect.stringContaining('disk full') })
  })
})
