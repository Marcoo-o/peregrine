import { afterEach, describe, expect, it, vi } from 'vitest'
import { listAllActions } from '@peregrine/core/pendingActionsStore'
import { emptyDraft } from '../draft'
import { DEFAULT_SEND_SETTINGS, loadSendSettings, saveSendSettings } from '../settings'
import { appHarness, eventually } from '../testing/appHarness'
import type { ComposeState, Screen } from './screens'

const returnTo: Screen = { name: 'login' }

afterEach(() => {
  vi.useRealTimers()
})

/** An account that is connected, and a message held back for ten seconds, with the clock under control. */
async function holding(seconds = 10) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-30T12:00:00Z'))
  const t = await appHarness()
  const work = await t.givenAccount('work', { INBOX: [], Trash: [], Sent: [], Drafts: [] })
  t.smtp.credentials = { user: 'work', pass: 'secret' }
  await t.app.services.connections.ensure(work)
  await saveSendSettings(t.db, { undoSeconds: seconds })
  t.app.compose.startNew(work, returnTo)
  const state = t.store.screen as ComposeState
  const draft = {
    ...state.draft,
    to: 'anna@example.net',
    subject: 'Budget',
    body: 'Numbers',
    attachments: [{ filename: 'a.pdf', path: '/store/1/a.pdf', contentType: 'application/pdf', size: 1234 }]
  }
  t.files.stored.set('/store/1/a.pdf', new Uint8Array([1, 2, 3]))
  const sent = () => t.smtp.messages.length
  const later = (ms: number) => vi.setSystemTime(Date.now() + ms)
  return { ...t, work, state, draft, sent, later }
}

describe('the time a message is held back', () => {
  it('is five seconds when nothing was set, which a setting of the user can change', async () => {
    const t = await appHarness()
    await t.db.run("DELETE FROM settings WHERE name = 'send'")
    expect(await loadSendSettings(t.db)).toEqual(DEFAULT_SEND_SETTINGS)
    expect(DEFAULT_SEND_SETTINGS.undoSeconds).toBe(5)
    await saveSendSettings(t.db, { undoSeconds: 20 })
    expect(await loadSendSettings(t.db)).toEqual({ undoSeconds: 20 })
  })

  it('takes only the times that are offered, and the default for what is not one', async () => {
    const t = await appHarness()
    await t.db.run("INSERT OR REPLACE INTO settings (name, value) VALUES ('send', ?)", JSON.stringify({ undoSeconds: 7 }))
    expect(await loadSendSettings(t.db)).toEqual(DEFAULT_SEND_SETTINGS)
    await t.db.run("UPDATE settings SET value = 'not json' WHERE name = 'send'")
    expect(await loadSendSettings(t.db)).toEqual(DEFAULT_SEND_SETTINGS)
  })
})

describe('sending with a time to take it back', () => {
  it('holds the message in the queue until the time is over, and offers to take it back', async () => {
    const t = await holding()
    await t.app.compose.send(t.state, t.draft)
    expect(t.sent()).toBe(0)
    const [action] = await listAllActions(t.db)
    expect(action).toMatchObject({ kind: 'send', dueAt: Date.now() + 10_000 })
    expect(t.store.state.undo).toEqual({ actionId: action.id, subject: 'Budget', until: Date.now() + 10_000 })
    expect(t.store.screen).toBe(returnTo)
  })

  it('sends it when the time is over, as any queued message goes', async () => {
    const t = await holding()
    await t.app.compose.send(t.state, t.draft)
    t.later(10_001)
    await t.app.services.mail.flush(t.work.id)
    expect(t.sent()).toBe(1)
    expect(new TextDecoder().decode(t.smtp.messages[0])).toContain('Subject: Budget')
  })

  it('sends it by itself when the time is over, without anybody running the queue', async () => {
    const t = await holding()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    await t.app.compose.send(t.state, t.draft)
    expect(t.sent()).toBe(0)
    await vi.advanceTimersByTimeAsync(11_500)
    await eventually(() => expect(t.sent()).toBe(1))
  })

  it('has the timer set again when the application starts with a message held back', async () => {
    const t = await holding()
    await t.app.compose.send(t.state, t.draft)
    await t.app.start()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    await t.app.services.mail.armDue()
    await vi.advanceTimersByTimeAsync(11_500)
    await eventually(() => expect(t.sent()).toBe(1))
  })

  it('sends it at once when no time was set, and offers nothing', async () => {
    const t = await holding(0)
    await t.app.compose.send(t.state, t.draft)
    expect(t.sent()).toBe(1)
    expect(t.store.state.undo).toBeNull()
  })
})

describe('taking a message back', () => {
  it('writes it on again, where it was written, with what it had, and sends nothing', async () => {
    const t = await holding()
    await t.app.compose.send(t.state, t.draft)
    t.later(3000)
    await t.app.compose.undoSend()
    expect(t.store.screen).toMatchObject({
      name: 'compose',
      account: { id: t.work.id },
      returnTo,
      draft: { to: 'anna@example.net', subject: 'Budget', body: 'Numbers', attachments: [{ filename: 'a.pdf', size: 1234 }] }
    })
    expect(await listAllActions(t.db)).toEqual([])
    expect(t.store.state.undo).toBeNull()
    t.later(60_000)
    await t.app.services.mail.flush(t.work.id)
    expect(t.sent()).toBe(0)
  })

  it('is too late when the time is over, and says so, and the message goes', async () => {
    const t = await holding()
    await t.app.compose.send(t.state, t.draft)
    t.later(10_001)
    await t.app.compose.undoSend()
    expect(t.store.state.undo).toMatchObject({ late: true })
    expect(t.store.screen).toBe(returnTo)
    await t.app.services.mail.flush(t.work.id)
    expect(t.sent()).toBe(1)
  })

  it('does nothing when there is nothing to take back, or when it was too late already', async () => {
    const t = await holding()
    const before = t.store.screen
    await t.app.compose.undoSend()
    expect(t.store.screen).toBe(before)
    await t.app.compose.send(t.state, t.draft)
    t.later(10_001)
    await t.app.compose.undoSend()
    const late = t.store.state.undo
    await t.app.compose.undoSend()
    expect(t.store.state.undo).toBe(late)
  })

  it('is for the newest message only: the one before is on its way', async () => {
    const t = await holding()
    await t.app.compose.send(t.state, t.draft)
    const first = t.store.state.undo!.actionId
    t.app.compose.startNew(t.work, returnTo)
    await t.app.compose.send(t.store.screen as ComposeState, { ...emptyDraft, to: 'bob@example.net', subject: 'Second', body: 'x' })
    expect(t.store.state.undo!.actionId).not.toBe(first)
    expect(t.store.state.undo).toMatchObject({ subject: 'Second' })
    t.later(11_000)
    await t.app.services.mail.flush(t.work.id)
    expect(t.sent()).toBe(2)
  })

  it('is gone when what is said of it is cleared', async () => {
    const t = await holding()
    await t.app.compose.send(t.state, t.draft)
    t.app.compose.clearUndo()
    expect(t.store.state.undo).toBeNull()
    await t.app.compose.undoSend()
    expect(t.store.screen).toBe(returnTo)
  })
})
