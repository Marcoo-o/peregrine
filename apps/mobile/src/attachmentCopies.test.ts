import { describe, expect, it } from 'vitest'
import { MAX_ATTEMPTS } from '@peregrine/core/pendingActions'
import { enqueueAction, recordPendingFailure } from '@peregrine/core/pendingActionsStore'
import type { ComposeInput } from '@peregrine/core/types'
import { referencedCopies, sweepCopies } from './attachmentCopies'
import { listFolders } from './folders'
import { appHarness } from './testing/appHarness'

const message = (accountId: string, ...paths: string[]): ComposeInput => ({
  accountId,
  to: [{ name: '', address: 'anna@example.net' }],
  cc: [],
  bcc: [],
  subject: 'Hi',
  textBody: 'Text',
  htmlBody: '',
  attachments: paths.map((path) => ({ filename: path.split('/').pop() as string, path }))
})

describe('the copies a queued message needs', () => {
  it('are those of every message waiting to be sent, whichever account it is from', async () => {
    const t = await appHarness()
    const work = await t.givenAccount('work', {})
    const home = await t.givenAccount('home', {})
    await enqueueAction(t.db, work.id, 'send', { input: message(work.id, '/store/a/report.pdf', '/store/b/notes.txt') })
    await enqueueAction(t.db, home.id, 'send', { input: message(home.id, '/store/c/photo.png') })
    expect(await referencedCopies(t.db)).toEqual(['/store/a/report.pdf', '/store/b/notes.txt', '/store/c/photo.png'])
  })

  it('include those of a message given up on, which is kept until somebody discards it', async () => {
    const t = await appHarness()
    const work = await t.givenAccount('work', {})
    const id = await enqueueAction(t.db, work.id, 'send', { input: message(work.id, '/store/a/report.pdf') })
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) await recordPendingFailure(t.db, id, 'refused')
    expect(await referencedCopies(t.db)).toEqual(['/store/a/report.pdf'])
  })

  it('include those of a message scheduled for later', async () => {
    const t = await appHarness()
    const work = await t.givenAccount('work', {})
    await enqueueAction(t.db, work.id, 'send', { input: message(work.id, '/store/a/report.pdf') }, Date.now() + 3600_000)
    expect(await referencedCopies(t.db)).toEqual(['/store/a/report.pdf'])
  })

  it('are none for actions that carry no file, or for an empty queue', async () => {
    const t = await appHarness()
    const work = await t.givenAccount('work', { INBOX: [{ uid: 1 }] })
    expect(await referencedCopies(t.db)).toEqual([])
    const folder = t.folderOf(await listFolders(t.db, work.id), 'INBOX')
    await enqueueAction(t.db, work.id, 'delete', { folderId: folder.id, uids: [1] })
    await enqueueAction(t.db, work.id, 'send', { input: message(work.id) })
    expect(await referencedCopies(t.db)).toEqual([])
  })
})

describe('sweeping the copies', () => {
  it('keeps what the queue refers to and nothing else', async () => {
    const t = await appHarness()
    const work = await t.givenAccount('work', {})
    await enqueueAction(t.db, work.id, 'send', { input: message(work.id, '/store/a/report.pdf') })
    await sweepCopies(t.db, t.files)
    expect(t.files.kept).toEqual(['/store/a/report.pdf'])
  })

  it('keeps nothing when nothing refers to a copy', async () => {
    const t = await appHarness()
    await sweepCopies(t.db, t.files)
    expect(t.files.kept).toEqual([])
  })
})

describe('when the application sweeps', () => {
  async function withQueuedMessages() {
    const t = await appHarness()
    const work = await t.givenAccount('work', {})
    const home = await t.givenAccount('home', {})
    const workMessage = await enqueueAction(t.db, work.id, 'send', { input: message(work.id, '/store/w/report.pdf') })
    await enqueueAction(t.db, home.id, 'send', { input: message(home.id, '/store/h/photo.png') })
    return { ...t, work, home, workMessage }
  }

  it('does so when it starts, before it shows anything', async () => {
    const t = await withQueuedMessages()
    await t.app.start()
    expect(t.files.kept).toEqual(['/store/w/report.pdf', '/store/h/photo.png'])
  })

  it('shows the first screen though the sweep failed, and says so', async () => {
    const t = await withQueuedMessages()
    t.files.keepOnly = async () => {
      throw new Error('disk error')
    }
    await t.app.start()
    expect(t.store.screen.name).not.toBe('loading')
    expect(t.logs.some((line) => line.includes('disk error'))).toBe(true)
  })

  it('does so when what failed too often is discarded, so that its files go with it', async () => {
    const t = await withQueuedMessages()
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) await recordPendingFailure(t.db, t.workMessage, 'refused')

    await t.app.discardFailedActions()

    expect(t.files.kept).toEqual(['/store/h/photo.png'])
  })

  it('does so when an account is removed, so that the files of its queue go with it', async () => {
    const t = await withQueuedMessages()
    await t.app.accounts.remove(t.work)
    expect(t.files.kept).toEqual(['/store/h/photo.png'])
  })
})
