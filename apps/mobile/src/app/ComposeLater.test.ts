import { afterEach, describe, expect, it, vi } from 'vitest'
import { listAllActions } from '@peregrine/core/pendingActionsStore'
import { draftFromInput, emptyDraft, toComposeInput } from '../draft'
import { saveSendSettings } from '../settings'
import { appHarness, eventually } from '../testing/appHarness'
import { scheduledText } from './queueStatus'
import type { ComposeState, Screen } from './screens'

const returnTo: Screen = { name: 'login' }

afterEach(() => {
  vi.useRealTimers()
})

async function planning() {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-30T12:00:00Z'))
  const t = await appHarness()
  const work = await t.givenAccount('work', { INBOX: [], Trash: [], Sent: [], Drafts: [] })
  t.smtp.credentials = { user: 'work', pass: 'secret' }
  await t.app.services.connections.ensure(work)
  // The time to take a message back is not what is looked at here.
  await saveSendSettings(t.db, { undoSeconds: 5 })
  t.app.compose.startNew(work, returnTo)
  const state = t.store.screen as ComposeState
  const draft = { ...emptyDraft, to: 'anna@example.net', cc: 'Lee <lee@example.net>', subject: 'Monday', body: 'Plan' }
  const at = Date.now() + 3 * 3600 * 1000
  const sent = () => t.smtp.messages.length
  return { ...t, work, state, draft, at, sent }
}

describe('sending at a later time', () => {
  it('queues the message until the moment, says nothing of taking it back, and sends nothing now', async () => {
    const t = await planning()
    await t.app.compose.send(t.state, t.draft, t.at)
    const [action] = await listAllActions(t.db)
    expect(action).toMatchObject({ kind: 'send', dueAt: t.at })
    expect(t.store.state.undo).toBeNull()
    expect(t.store.screen).toBe(returnTo)
    expect(t.sent()).toBe(0)
  })

  it('sends it when the moment comes', async () => {
    const t = await planning()
    await t.app.compose.send(t.state, t.draft, t.at)
    vi.setSystemTime(t.at + 5000)
    await t.app.services.mail.flush(t.work.id)
    expect(t.sent()).toBe(1)
  })

  it('goes at once, with the time to take it back, when the moment is not ahead', async () => {
    const t = await planning()
    await t.app.compose.send(t.state, t.draft, Date.now() - 1000)
    const [action] = await listAllActions(t.db)
    expect(action.dueAt).toBe(Date.now() + 5000)
    expect(t.store.state.undo).not.toBeNull()
  })

  it('is said in the status line as planned, and not as waiting for a connection', async () => {
    const t = await planning()
    await t.app.compose.send(t.state, t.draft, t.at)
    await t.app.services.mail.armDue()
    const summary = await t.app.services.mail.waiting()
    expect(summary).toMatchObject({ scheduled: 1, total: 0 })
    expect(scheduledText(summary)).toBe('1 Nachricht ist zum Senden geplant')
    expect(scheduledText({ ...summary, scheduled: 3 })).toBe('3 Nachrichten sind zum Senden geplant')
    expect(scheduledText({ ...summary, scheduled: 0 })).toBeNull()
  })
})

describe('the planned messages', () => {
  it('are listed with to whom and what about, and the screen goes back to where it was', async () => {
    const t = await planning()
    await t.app.compose.send(t.state, t.draft, t.at)
    await t.app.compose.showScheduled()
    expect(t.store.screen).toMatchObject({ name: 'scheduled', returnTo, items: [{ to: 'anna@example.net', subject: 'Monday', dueAt: t.at }] })
    t.app.compose.leaveScheduled(t.store.screen as never)
    expect(t.store.screen).toBe(returnTo)
  })

  it('can be taken back and written on again, with everything, and are then not sent', async () => {
    const t = await planning()
    await t.app.compose.send(t.state, t.draft, t.at)
    await t.app.compose.showScheduled()
    const listed = t.store.screen as Extract<Screen, { name: 'scheduled' }>
    await t.app.compose.takeBack(listed, listed.items[0].id)
    expect(t.store.screen).toMatchObject({ name: 'compose', draft: { to: 'anna@example.net', cc: 'Lee <lee@example.net>', subject: 'Monday', body: 'Plan' } })
    expect(await listAllActions(t.db)).toEqual([])
    vi.setSystemTime(t.at + 5000)
    await t.app.services.mail.flush(t.work.id)
    expect(t.sent()).toBe(0)
  })

  it('show again without a message that is gone when it is taken back too late', async () => {
    const t = await planning()
    await t.app.compose.send(t.state, t.draft, t.at)
    await t.app.compose.showScheduled()
    const listed = t.store.screen as Extract<Screen, { name: 'scheduled' }>
    vi.setSystemTime(t.at + 1)
    await t.app.compose.takeBack(listed, listed.items[0].id)
    expect(t.store.screen).toMatchObject({ name: 'scheduled', items: [] })
  })

  it('go by themselves at the moment, without the queue being run by hand', async () => {
    const t = await planning()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    await t.app.compose.send(t.state, t.draft, Date.now() + 20_000)
    await vi.advanceTimersByTimeAsync(21_500)
    await eventually(() => expect(t.sent()).toBe(1))
  })
})

describe('a draft made from what was queued', () => {
  it('is what it was made from, apart from the sizes of the files', () => {
    const draft = { ...emptyDraft, to: 'a@example.net, Bea <b@example.net>', subject: 'S', body: 'B', identityId: 'i1', sign: true, attachments: [{ filename: 'f.txt', path: '/p/f.txt', contentType: 'text/plain', size: 10 }] }
    expect(draftFromInput(toComposeInput('acc', draft))).toEqual({ ...draft, cc: '', bcc: '', inReplyTo: undefined, references: undefined, encrypt: undefined, attachments: [{ ...draft.attachments[0], size: 0 }] })
  })
})
