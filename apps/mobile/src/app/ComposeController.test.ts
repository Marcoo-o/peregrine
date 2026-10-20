import { describe, expect, it } from 'vitest'
import { listPendingActions } from '@peregrine/core/pendingActionsStore'
import { getAccount } from '../accounts'
import { emptyDraft, type Draft } from '../draft'
import { appHarness, eventually } from '../testing/appHarness'
import { senderProblem } from './ComposeController'
import type { ComposeState, MessageState, Screen } from './screens'

const returnTo: Screen = { name: 'login' }

async function composing() {
  const t = await appHarness()
  const work = await t.givenAccount('work', { INBOX: [], Trash: [], Sent: [] })
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

  it('starts an answer that quotes the message, and goes back to the message', async () => {
    const t = await composing()
    const message: MessageState = {
      name: 'message',
      account: t.work,
      folder: undefined as never,
      summary: undefined as never,
      origin: 'folder',
      message: {
        subject: 'Lunch',
        from: 'Anna <anna@example.net>',
        date: 'Mon, 19 Oct 2026 10:00:00 +0200',
        text: 'Shall we?',
        messageId: '<one@example.net>',
        references: '',
        replyTo: ''
      }
    }
    t.app.compose.startReply(message)
    const screen = t.store.screen as ComposeState
    expect(screen.draft).toMatchObject({ to: 'Anna <anna@example.net>', subject: 'Re: Lunch', inReplyTo: '<one@example.net>' })
    expect(screen.returnTo).toBe(message)
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
