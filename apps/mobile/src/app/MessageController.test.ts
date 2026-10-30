import { describe, expect, it } from 'vitest'
import { listFolders } from '../folders'
import { listMessages } from '../messages'
import { appHarness, eventually } from '../testing/appHarness'
import type { MessageState, MoveState } from './screens'

const crlf = (lines: string[]): string => lines.join('\r\n')

/** A message with a small file and a program that has a double extension. */
const WITH_ATTACHMENTS = crlf([
  'From: Carla <carla@example.net>',
  'Subject: Contract',
  'Message-ID: <one@example.net>',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="b"',
  '',
  '--b',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'The contract is attached.',
  '--b',
  'Content-Type: application/pdf; name="contract.pdf"',
  'Content-Disposition: attachment; filename="contract.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  'JVBERi0xLjQK',
  '--b',
  'Content-Type: application/octet-stream; name="invoice.pdf.exe"',
  'Content-Disposition: attachment; filename="invoice.pdf.exe"',
  'Content-Transfer-Encoding: base64',
  '',
  'TVoAAA==',
  '--b--',
  ''
])

/** An account that is connected, with one message in its inbox that has attachments. */
async function connectedInbox(over: { seen?: boolean } = {}) {
  const t = await appHarness()
  const work = await t.givenAccount('work', {
    INBOX: [{ uid: 1, subject: 'Contract', flags: over.seen ? ['\\Seen'] : [], source: WITH_ATTACHMENTS }],
    Trash: []
  })
  const folders = await listFolders(t.db, work.id)
  const folder = t.folderOf(folders, 'INBOX')
  const summary = (await listMessages(t.db, folder.id))[0]
  await t.app.services.connections.ensure(work)
  t.server.calls.length = 0
  return { ...t, work, folder, folders, summary }
}

type Inbox = Awaited<ReturnType<typeof connectedInbox>>

async function opened(t: Inbox, origin: 'folder' | 'unified' = 'folder'): Promise<MessageState> {
  await t.app.messages.open(t.work, t.folder, t.summary, origin)
  const screen = t.store.screen
  if (screen.name !== 'message') throw new Error(`expected the message, got ${screen.name}`)
  return screen
}

describe('opening a message', () => {
  it('shows it as loading first, then with its text, its source and its attachments', async () => {
    const t = await connectedInbox()
    const screens: string[] = []
    t.store.subscribe(() => screens.push(t.store.screen.name === 'message' && t.store.screen.message ? 'loaded' : t.store.screen.name))

    const state = await opened(t)

    expect(screens[0]).toBe('message')
    expect(state.message?.text).toContain('The contract is attached.')
    expect(state.attachments?.map((a) => a.filename)).toEqual(['contract.pdf', 'invoice.pdf.exe'])
    expect(state.source).toBeInstanceOf(Uint8Array)
  })

  it('marks it read, here at once and on the server through the queue', async () => {
    const t = await connectedInbox()
    await opened(t)
    await eventually(() => expect(t.server.calls).toContain('add INBOX 1 \\Seen'))
    expect((await listMessages(t.db, t.folder.id))[0].flags).toContain('\\Seen')
  })

  it('does not mark a message read that is read already', async () => {
    const t = await connectedInbox({ seen: true })
    await opened(t)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(t.server.calls.filter((call) => call.startsWith('add'))).toEqual([])
  })

  it('says why when the server does not have the message any more', async () => {
    const t = await connectedInbox()
    t.server.mailboxes.get('work')!.INBOX = []
    await t.app.messages.open(t.work, t.folder, t.summary, 'folder')
    expect(t.store.screen).toMatchObject({ name: 'message', error: 'Die Nachricht gibt es auf dem Server nicht mehr' })
  })

  it('says why when the server cannot be reached for the text', async () => {
    const t = await connectedInbox()
    t.app.services.connections.drop(t.work.id)
    t.server.unreachable.add('work')
    await t.app.messages.open(t.work, t.folder, t.summary, 'folder')
    expect(t.store.screen).toMatchObject({ name: 'message', error: 'Der Server ist nicht erreichbar. (work: connection refused)' })
  })

  it('opens a message of the unified list by its account and folder', async () => {
    const t = await connectedInbox()
    await t.app.messages.openFromUnified({
      ...t.summary,
      accountId: t.work.id,
      folderId: t.folder.id,
      accountName: 'work',
      accountColor: '#2f5d9f'
    })
    expect(t.store.screen).toMatchObject({ name: 'message', origin: 'unified', account: { id: t.work.id } })
  })
})

describe('leaving a message', () => {
  it('goes back to the folder it was opened from', async () => {
    const t = await connectedInbox()
    await t.app.messages.leave(await opened(t, 'folder'))
    expect(t.store.screen).toMatchObject({ name: 'messages', folder: { id: t.folder.id } })
  })

  it('goes back to the unified list when it was opened from there', async () => {
    const t = await connectedInbox()
    await t.app.messages.leave(await opened(t, 'unified'))
    expect(t.store.screen.name).toBe('unified')
  })
})

describe('working on a message', () => {
  it('marks it unread through the queue and shows the list', async () => {
    const t = await connectedInbox({ seen: true })
    await t.app.messages.markUnread(await opened(t))
    expect(t.server.calls).toContain('remove INBOX 1 \\Seen')
    expect(t.store.screen.name).toBe('messages')
  })

  it('sets a tag on it and takes it off, through the queue, staying on the message', async () => {
    const t = await connectedInbox()
    await t.app.messages.setTag(await opened(t), 'Work', true)
    expect(t.store.screen).toMatchObject({ name: 'message', summary: { flags: expect.arrayContaining(['Work']) } })
    expect(t.server.calls).toContain('add INBOX 1 Work')

    await t.app.messages.setTag(t.store.screen as MessageState, 'Work', false)
    expect((t.store.screen as MessageState).summary.flags).not.toContain('Work')
    expect(t.server.calls).toContain('remove INBOX 1 Work')
  })

  it('puts it aside until a moment and goes back to the list, which does not have it any more, and does not ask the server', async () => {
    const t = await connectedInbox()
    await t.app.messages.snooze(await opened(t), Date.now() + 3_600_000)
    expect(t.store.screen).toMatchObject({ name: 'messages', messages: [] })
    // Reading it was told to the server, as always; putting it aside is not told, and moves nothing.
    expect(t.server.calls.filter((call) => /^(move|delete|remove)/.test(call))).toEqual([])
  })

  it('brings a message that is put aside back now, staying on it', async () => {
    const t = await connectedInbox()
    const open = await opened(t)
    await t.app.messages.snooze(open, Date.now() + 3_600_000)
    t.store.showScreen(open)
    await t.app.messages.unsnooze(open)
    expect(t.store.screen).toMatchObject({ name: 'message', summary: { snoozedUntil: null } })
    await t.app.navigator.showMessages(open.account, open.folder, { sync: false })
    expect(t.store.screen).toMatchObject({ name: 'messages', messages: [{ uid: open.summary.uid }] })
  })

  it('stars it and takes the star off, staying on the message', async () => {
    const t = await connectedInbox()
    await t.app.messages.toggleFlagged(await opened(t))
    expect(t.store.screen).toMatchObject({ name: 'message', summary: { flags: expect.arrayContaining(['\\Flagged']) } })

    await t.app.messages.toggleFlagged(t.store.screen as MessageState)
    const flags = (t.store.screen as MessageState).summary.flags
    expect(flags).not.toContain('\\Flagged')
    expect(t.server.calls).toContain('add INBOX 1 \\Flagged')
    expect(t.server.calls).toContain('remove INBOX 1 \\Flagged')
  })

  it('deletes it into the trash folder and shows the list without it', async () => {
    const t = await connectedInbox()
    await t.app.messages.delete(await opened(t))
    expect(t.server.calls).toContain('move INBOX > Trash 1')
    expect(t.store.screen).toMatchObject({ name: 'messages', messages: [] })
  })

  it('goes on to the list when the action fails, and says what failed', async () => {
    const t = await connectedInbox()
    const state = await opened(t)
    t.app.services.mail.remove = async () => {
      throw new Error('disk full')
    }
    await t.app.messages.delete(state)
    expect(t.logs).toContain('disk full')
    expect(t.store.screen.name).toBe('messages')
  })

  describe('moving', () => {
    it('offers the other folders of the account', async () => {
      const t = await connectedInbox()
      await t.app.messages.startMove(await opened(t))
      const screen = t.store.screen as MoveState
      expect(screen.name).toBe('move')
      expect(screen.targets.map((folder) => folder.imapPath)).toEqual(['Trash'])
    })

    it('goes back to the message exactly as it was, with its text and attachments', async () => {
      const t = await connectedInbox()
      const message = await opened(t)
      await t.app.messages.startMove(message)
      t.app.messages.cancelMove(t.store.screen as MoveState)
      expect(t.store.screen).toBe(message)
    })

    it('moves it through the queue and shows the list', async () => {
      const t = await connectedInbox()
      await t.app.messages.startMove(await opened(t))
      const trash = t.folderOf(t.folders, 'Trash')
      await t.app.messages.move(t.store.screen as MoveState, trash)
      expect(t.server.calls).toContain('move INBOX > Trash 1')
      expect(t.store.screen.name).toBe('messages')
    })
  })
})

describe('the attachments of a message', () => {
  const info = (state: MessageState, filename: string) => {
    const found = state.attachments?.find((a) => a.filename === filename)
    if (!found) throw new Error(`no attachment ${filename}`)
    return found
  }

  describe('saving', () => {
    it('hands the bytes to the files and says where it went', async () => {
      const t = await connectedInbox()
      const state = await opened(t)
      await t.app.messages.saveAttachment(state, info(state, 'contract.pdf'))
      expect(t.files.saved).toHaveLength(1)
      expect(t.files.saved[0]).toMatchObject({ name: 'contract.pdf', contentType: 'application/pdf' })
      expect(new TextDecoder().decode(t.files.saved[0].content)).toBe('%PDF-1.4\n')
      expect(t.store.screen).toMatchObject({ notice: 'Gespeichert: contract.pdf' })
    })

    it('says nothing when the user chose no place', async () => {
      const t = await connectedInbox()
      t.files.saveAnswer = false
      const state = await opened(t)
      await t.app.messages.saveAttachment(state, info(state, 'contract.pdf'))
      expect((t.store.screen as MessageState).notice).toBeUndefined()
    })

    it('saves a program too, because keeping a file is the person’s decision', async () => {
      const t = await connectedInbox()
      const state = await opened(t)
      await t.app.messages.saveAttachment(state, info(state, 'invoice.pdf.exe'))
      expect(t.files.saved.map((file) => file.name)).toEqual(['invoice.pdf.exe'])
    })

    it('says why when saving failed', async () => {
      const t = await connectedInbox()
      t.files.failWith = new Error('no space left')
      const state = await opened(t)
      await t.app.messages.saveAttachment(state, info(state, 'contract.pdf'))
      expect(t.store.screen).toMatchObject({ notice: 'Speichern ging nicht: no space left' })
    })

    it('does not put a notice over a screen the user has gone to meanwhile', async () => {
      const t = await connectedInbox()
      const state = await opened(t)
      t.files.save = async () => {
        t.app.navigator.showLogin()
        return true
      }
      await t.app.messages.saveAttachment(state, info(state, 'contract.pdf'))
      expect(t.store.screen.name).toBe('login')
    })
  })

  describe('opening', () => {
    it('hands a document to another application', async () => {
      const t = await connectedInbox()
      const state = await opened(t)
      await t.app.messages.openAttachment(state, info(state, 'contract.pdf'))
      expect(t.files.opened.map((file) => file.name)).toEqual(['contract.pdf'])
    })

    it('refuses a program, and says why and that saving is possible', async () => {
      const t = await connectedInbox()
      const state = await opened(t)
      await t.app.messages.openAttachment(state, info(state, 'invoice.pdf.exe'))
      expect(t.files.opened).toEqual([])
      expect((t.store.screen as MessageState).notice).toContain('Nicht geöffnet')
      expect((t.store.screen as MessageState).notice).toContain('Speichern')
    })

    it('says why when no application could open it', async () => {
      const t = await connectedInbox()
      t.files.failWith = new Error('No application on this phone can open this file')
      const state = await opened(t)
      await t.app.messages.openAttachment(state, info(state, 'contract.pdf'))
      expect(t.store.screen).toMatchObject({ notice: 'Öffnen ging nicht: No application on this phone can open this file' })
    })
  })

  it('does nothing for a message whose source is not there', async () => {
    const t = await connectedInbox()
    const loading: MessageState = { name: 'message', account: t.work, folder: t.folder, summary: t.summary, origin: 'folder' }
    t.store.showScreen(loading)
    await t.app.messages.saveAttachment(loading, { id: '2', filename: 'x', originalName: 'x', contentType: 'a/b', size: 1, findings: [] })
    expect(t.files.saved).toEqual([])
    expect(t.store.screen).toBe(loading)
  })
})

describe('a message a notification was tapped for', () => {
  it('is opened from the application’s own copy, and leaving it goes to the folder', async () => {
    const t = await connectedInbox()
    await t.app.messages.openTarget({ accountId: t.work.id, folderId: t.folder.id, uid: 1 })
    expect(t.store.screen).toMatchObject({ name: 'message', origin: 'folder', summary: { uid: 1 } })
  })

  it('is not opened when the account, the folder or the message is gone', async () => {
    const t = await connectedInbox()
    t.store.showScreen({ name: 'login' })
    await t.app.messages.openTarget({ accountId: 'nobody', folderId: t.folder.id, uid: 1 })
    await t.app.messages.openTarget({ accountId: t.work.id, folderId: 'nothing', uid: 1 })
    await t.app.messages.openTarget({ accountId: t.work.id, folderId: t.folder.id, uid: 99 })
    expect(t.store.screen.name).toBe('login')
  })
})

const SUSPICIOUS = crlf([
  'From: "service@bank.example" <phish@attacker.test>',
  'Reply-To: collect@elsewhere.test',
  'Subject: Your account',
  'Authentication-Results: mx.example.org; spf=fail; dkim=none; dmarc=fail',
  'X-Spamd-Result: default: True [16.00 / 15.00]; FORGED_SENDER(5.00)[]',
  'Content-Type: text/plain',
  '',
  'Please log in.',
  ''
])

async function inboxWith(source: string, folders: Record<string, never[]> = { Trash: [], Archive: [], Junk: [] }) {
  const t = await appHarness()
  const work = await t.givenAccount('work', { INBOX: [{ uid: 1, subject: 'Your account', source }], ...folders })
  const folder = t.folderOf(await listFolders(t.db, work.id), 'INBOX')
  const summary = (await listMessages(t.db, folder.id))[0]
  await t.app.services.connections.ensure(work)
  t.server.calls.length = 0
  return { ...t, work, folder, summary }
}

async function openedFrom(t: Awaited<ReturnType<typeof inboxWith>>): Promise<MessageState> {
  await t.app.messages.open(t.work, t.folder, t.summary, 'folder')
  const screen = t.store.screen
  if (screen.name !== 'message') throw new Error(`expected the message, got ${screen.name}`)
  return screen
}

describe('what is known of a message that is opened', () => {
  it('is what the server made of it and what is wrong with who it says it is from, with the domains of the user', async () => {
    const t = await inboxWith(SUSPICIOUS)
    const state = await openedFrom(t)

    expect(state.knownDomains).toEqual(['example.org'])
    expect(state.assessment?.spam).toMatchObject({ verdict: 'spam' })
    expect(state.assessment?.failedAuth).toEqual(['dmarc', 'spf'])
    expect(state.assessment?.sender.map((finding) => finding.risk)).toEqual(['nameContainsOtherAddress', 'replyToMismatch'])
  })

  it('is nothing for an ordinary message', async () => {
    // Not under example.net: the accounts are under example.org, and a name that is the same under another ending looks like theirs.
    const t = await inboxWith(crlf(['From: Anna <anna@sender.test>', 'Subject: Hi', '', 'Hello', '']))
    const state = await openedFrom(t)
    expect(state.assessment).toMatchObject({ spam: null, failedAuth: [], sender: [] })
  })

  it('does not take what the user wrote for a first message from somebody', async () => {
    const t = await inboxWith(crlf(['From: Alex <work@example.org>', 'Subject: Note to self', '', 'Hello', '']))
    const state = await openedFrom(t)
    expect(state.assessment?.firstContact).toBe(false)
  })

  it('keeps the text of a message it fetched, which is the line the list shows under its subject from then on', async () => {
    const t = await inboxWith(crlf(['From: Anna <anna@sender.test>', 'Subject: Hi', '', 'Shall we meet on Friday?', '']))
    await openedFrom(t)
    await eventually(async () => {
      const [stored] = await listMessages(t.db, t.folder.id)
      expect(stored.preview).toBe('Shall we meet on Friday?')
    })
  })

  it('knows a first message from an address by the messages the phone has of it', async () => {
    const t = await inboxWith(crlf(['From: Anna <anna@sender.test>', 'Subject: Hi', '', 'Hello', '']))
    const state = await openedFrom(t)
    // The message that is open is stored, and is the only one from its sender there.
    expect(state.assessment?.firstContact).toBe(true)
  })
})

describe('putting a message away', () => {
  it('moves it to the archive of its account and shows the list without it', async () => {
    const t = await inboxWith(SUSPICIOUS)
    await t.app.messages.archive(await openedFrom(t))
    expect(t.server.calls).toContain('move INBOX > Archive 1')
    expect(t.store.screen).toMatchObject({ name: 'messages', messages: [] })
  })

  it('moves it to the spam folder of its account', async () => {
    const t = await inboxWith(SUSPICIOUS)
    await t.app.messages.markAsJunk(await openedFrom(t))
    expect(t.server.calls).toContain('move INBOX > Junk 1')
    expect(t.store.screen).toMatchObject({ name: 'messages', messages: [] })
  })

  it('says so, and stays on the message, when the account has no archive', async () => {
    const t = await inboxWith(SUSPICIOUS, { Trash: [], Junk: [] })
    const state = await openedFrom(t)
    await t.app.messages.archive(state)
    expect(t.server.calls.filter((call) => call.startsWith('move'))).toEqual([])
    expect(t.store.screen).toMatchObject({ name: 'message', notice: 'Für dieses Konto ist kein Archivordner vorhanden' })
  })

  it('says so, and stays on the message, when the account has no spam folder', async () => {
    const t = await inboxWith(SUSPICIOUS, { Trash: [], Archive: [] })
    await t.app.messages.markAsJunk(await openedFrom(t))
    expect(t.store.screen).toMatchObject({ name: 'message', notice: 'Für dieses Konto ist kein Spam-Ordner vorhanden' })
  })
})

describe('a message that a search found', () => {
  it('is opened from the account and folder it is in, and leaving it goes back to the same search', async () => {
    const t = await connectedInbox()
    await t.app.navigator.showSearch('contract')
    const found = t.store.screen
    if (found.name !== 'search') throw new Error('not the search')

    await t.app.messages.openFromSearch(found.messages[0], 'contract')
    expect(t.store.screen).toMatchObject({ name: 'message', origin: 'search', searchQuery: 'contract' })

    const message = t.store.screen
    if (message.name !== 'message') throw new Error('not the message')
    await t.app.messages.leave(message)
    expect(t.store.screen).toMatchObject({ name: 'search', query: 'contract' })
  })

  it('goes back to the search after being moved, where the message is no longer in its place', async () => {
    const t = await connectedInbox()
    await t.app.navigator.showSearch('contract')
    const found = t.store.screen
    if (found.name !== 'search') throw new Error('not the search')
    await t.app.messages.openFromSearch(found.messages[0], 'contract')
    const message = t.store.screen
    if (message.name !== 'message') throw new Error('not the message')

    await t.app.messages.delete(message)

    expect(t.store.screen).toMatchObject({ name: 'search', query: 'contract' })
  })
})

describe('the source of a message', () => {
  it('is shown as the server has it, and the screen goes back to the message as it was', async () => {
    const t = await connectedInbox()
    const state = await opened(t)
    t.app.messages.showSource(state)
    expect(t.store.screen).toMatchObject({ name: 'source', message: state, truncated: false, text: expect.stringContaining('Subject:') })
    t.app.messages.closeSource(t.store.screen as never)
    expect(t.store.screen).toBe(state)
  })

  it('is cut where it is very large, and says so', async () => {
    const t = await connectedInbox()
    const state = await opened(t)
    t.app.messages.showSource({ ...state, raw: new Uint8Array(300_000).fill(65) })
    const shown = t.store.screen as { text: string; truncated: boolean }
    expect(shown.truncated).toBe(true)
    expect(shown.text).toHaveLength(200_000)
  })

  it('is nothing before the message has arrived', async () => {
    const t = await connectedInbox()
    const state = await opened(t)
    t.app.messages.showSource({ ...state, raw: undefined })
    expect(t.store.screen.name).toBe('message')
  })

  it('is saved as an .eml with the subject for its name, as the server has it', async () => {
    const t = await connectedInbox()
    const state = await opened(t)
    await t.app.messages.saveSource(state)
    expect(t.files.saved).toHaveLength(1)
    expect(t.files.saved[0].name).toMatch(/\.eml$/)
    expect(t.files.saved[0].contentType).toBe('message/rfc822')
    expect(new TextDecoder().decode(t.files.saved[0].content)).toContain('Subject:')
    expect(t.store.screen).toMatchObject({ notice: expect.stringMatching(/^Gespeichert: .*\.eml$/) })
  })

  it('says why when saving failed, and nothing when no place was chosen', async () => {
    const t = await connectedInbox()
    const state = await opened(t)
    t.files.saveAnswer = false
    await t.app.messages.saveSource(state)
    expect((t.store.screen as MessageState).notice).toBeUndefined()
    t.files.failWith = new Error('no space left')
    await t.app.messages.saveSource(t.store.screen as MessageState)
    expect(t.store.screen).toMatchObject({ notice: expect.stringContaining('no space left') })
  })
})

describe('the checks that can be switched off', () => {
  const info = (state: MessageState, filename: string) => state.attachments!.find((a) => a.filename === filename)!

  it('hand a program to another application when the check for risky attachments is off', async () => {
    const t = await connectedInbox()
    await t.app.settings.setSafety({ warnRiskyAttachments: false })
    const state = await opened(t)
    await t.app.messages.openAttachment(state, info(state, 'invoice.pdf.exe'))
    expect(t.files.opened.map((file) => file.name)).toEqual(['invoice.pdf.exe'])
  })

  it('keep refusing it while the check is on, which it is until the user says otherwise', async () => {
    const t = await connectedInbox()
    const state = await opened(t)
    await t.app.messages.openAttachment(state, info(state, 'invoice.pdf.exe'))
    expect(t.files.opened).toEqual([])
  })
})

describe('a conversation', () => {
  it('is shown with its messages, and the screen it came from is shown again when it is left', async () => {
    const t = await connectedInbox()
    const back = t.store.screen
    t.app.messages.showThread({ subject: 'Contract', origin: 'folder', returnTo: back, items: [{ message: t.summary, accountId: t.work.id, folderId: t.folder.id }] })
    expect(t.store.screen).toMatchObject({ name: 'thread', subject: 'Contract', origin: 'folder' })
    t.app.messages.closeThread(t.store.screen as never)
    expect(t.store.screen).toBe(back)
  })

  it('opens a message of it as it is opened from the list it was in', async () => {
    const t = await connectedInbox()
    t.app.messages.showThread({ subject: 'Contract', origin: 'unified', returnTo: t.store.screen, items: [{ message: t.summary, accountId: t.work.id, folderId: t.folder.id }] })
    const thread = t.store.screen as Extract<typeof t.store.screen, { name: 'thread' }>
    await t.app.messages.openFromThread(thread, thread.items[0])
    expect(t.store.screen).toMatchObject({ name: 'message', origin: 'unified', summary: { uid: 1 } })
  })

  it('opens nothing for a message whose account or folder is gone', async () => {
    const t = await connectedInbox()
    t.app.messages.showThread({ subject: 'x', origin: 'folder', returnTo: t.store.screen, items: [{ message: t.summary, accountId: 'gone', folderId: 'gone' }] })
    const thread = t.store.screen as Extract<typeof t.store.screen, { name: 'thread' }>
    await t.app.messages.openFromThread(thread, thread.items[0])
    expect(t.store.screen.name).toBe('thread')
  })
})

describe('printing a message', () => {
  it('hands the message as it is read to the print service, under the name of its subject', async () => {
    const t = await connectedInbox()
    const state = await opened(t)
    await t.app.messages.print(state)
    expect(t.printer.printed).toHaveLength(1)
    expect(t.printer.printed[0].jobName).toBe('Contract')
    expect(t.printer.printed[0].html).toContain('Contract')
  })

  it('says why when it could not, and prints nothing before the message has arrived', async () => {
    const t = await connectedInbox()
    const state = await opened(t)
    t.printer.failWith = new Error('no printing service')
    await t.app.messages.print(state)
    expect(t.store.screen).toMatchObject({ notice: expect.stringContaining('no printing service') })
    await t.app.messages.print({ ...state, message: undefined })
    expect(t.printer.printed).toEqual([])
  })
})

