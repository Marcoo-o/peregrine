import type { FetchedMessage, ImapSession, MailboxEntry } from '@peregrine/core/imapSession'
import { language, useSystemLanguages } from '../i18n'
import { FakeSmtpServer } from '../../../../packages/smtp/test-support/fakeServer'
import { addAccount, type Account, type NewAccount } from '../accounts'
import { Application, createApplication } from '../app/Application'
import type { Notifications, PushDevice, PushSource, PushState, SyncSchedule } from '../background/devices'
import type { MailNotification, MessageTarget } from '../background/notifications'
import type { ImapLogin } from '../app/accountForm'
import type { Platform } from '../app/services'
import { AppStore } from '../app/store'
import type { DeviceLock } from '../lock'
import type { Printer } from '../printing'
import { saveSendSettings } from '../settings'
import type { Contact, DeviceContacts } from '../contacts'
import type { Files, PickedFile } from '../files'
import type { Incoming } from '../incoming'
import { syncFolders, type Folder } from '../folders'
import { saveMessages } from '../messages'
import { FakeTimers } from './fakeTimers'
import { migratedDatabase } from './testDb'

/** A message on the fake server, with the little it needs to be listed and, when it has a source, read. */
export interface FakeMessage {
  uid: number
  subject?: string
  date?: Date
  flags?: string[]
  /** Its Message-ID and the one it answers, for a conversation. */
  messageId?: string
  inReplyTo?: string
  /** The whole message as text. Without it the message can be listed and not fetched. */
  source?: string
}

const ROLES: Record<string, string> = {
  INBOX: '\\Inbox',
  Trash: '\\Trash',
  Archive: '\\Archive',
  Junk: '\\Junk',
  Sent: '\\Sent',
  Drafts: '\\Drafts'
}

/** One account's mail on the fake server: folders by path. */
type Mailbox = Record<string, FakeMessage[]>

/** A mail server that knows its accounts' mail, answers what the application asks and writes down what it is told. */
export class FakeMailServer {
  /** What the application asked of it, in order: `add INBOX 1 \Seen`, `move INBOX > Trash 2`. */
  readonly calls: string[] = []
  readonly mailboxes = new Map<string, Mailbox>()
  /** Users whose connection is refused. */
  readonly unreachable = new Set<string>()
  /** When set, the server refuses to change flags and says this. */
  refuseFlags: string | null = null
  /** When set, the server refuses to make, rename or delete a folder and says this. */
  refuseFolders: string | null = null
  readonly sessions: FakeSession[] = []

  addUser(user: string, mailbox: Mailbox): void {
    this.mailboxes.set(user, mailbox)
  }

  connect(login: ImapLogin): FakeSession {
    if (this.unreachable.has(login.username)) throw new Error(`${login.username}: connection refused`)
    const session = new FakeSession(this, login.username)
    this.sessions.push(session)
    return session
  }
}

class FakeSession {
  private closeListener: () => void = () => undefined

  constructor(
    private readonly server: FakeMailServer,
    private readonly user: string
  ) {}

  private get mailbox(): Mailbox {
    return this.server.mailboxes.get(this.user) ?? {}
  }

  onClose(listener: () => void): void {
    this.closeListener = listener
  }

  async disconnect(): Promise<void> {
    this.server.calls.push(`disconnect ${this.user}`)
  }

  /** The server ends the connection. */
  end(): void {
    this.closeListener()
  }

  async listMailboxes(): Promise<MailboxEntry[]> {
    return Object.keys(this.mailbox).map((path) => {
      const cut = path.lastIndexOf('/')
      return {
        path,
        name: path.slice(cut + 1),
        parentPath: cut === -1 ? null : path.slice(0, cut),
        flags: [],
        specialUse: ROLES[path] ?? null
      }
    })
  }

  async pathDelimiter(): Promise<string> {
    return '/'
  }

  async createMailbox(path: string): Promise<void> {
    this.server.calls.push(`create ${path}`)
    if (this.server.refuseFolders) throw new Error(this.server.refuseFolders)
    if (this.mailbox[path]) throw new Error('[ALREADYEXISTS] Mailbox already exists')
    this.mailbox[path] = []
  }

  async renameMailbox(path: string, newPath: string): Promise<void> {
    this.server.calls.push(`rename ${path} > ${newPath}`)
    if (this.server.refuseFolders) throw new Error(this.server.refuseFolders)
    for (const own of Object.keys(this.mailbox)) {
      if (own !== path && !own.startsWith(`${path}/`)) continue
      this.mailbox[newPath + own.slice(path.length)] = this.mailbox[own]
      delete this.mailbox[own]
    }
  }

  async deleteMailbox(path: string): Promise<void> {
    this.server.calls.push(`delete-folder ${path}`)
    if (this.server.refuseFolders) throw new Error(this.server.refuseFolders)
    delete this.mailbox[path]
  }

  async syncFetch(path: string, decide: (status: { uidValidity: bigint; uidNext: number }) => string | Promise<string>) {
    const messages = this.mailbox[path] ?? []
    const range = await decide({ uidValidity: 1n, uidNext: Math.max(0, ...messages.map((m) => m.uid)) + 1 })
    // What the folder has, as a sync is given it: the headers of the range and the flags of everything.
    const first = Number(range.split(':')[0])
    return {
      messages: messages.filter((m) => m.uid >= first).map(toFetched),
      flags: messages.map((m) => ({ uid: m.uid, flags: m.flags ?? [] }))
    }
  }

  async fetchMessages(path: string, uids: number[]) {
    return (this.mailbox[path] ?? []).filter((m) => uids.includes(m.uid)).map(toFetched)
  }

  async fetchFullMessage(path: string, uid: number) {
    const found = (this.mailbox[path] ?? []).find((m) => m.uid === uid)
    if (found?.source === undefined) return undefined
    return { source: Uint8Array.from(found.source, (c) => c.charCodeAt(0)) }
  }

  async addFlags(path: string, uid: number, flags: string[]): Promise<void> {
    if (this.server.refuseFlags) throw new Error(this.server.refuseFlags)
    this.server.calls.push(`add ${path} ${uid} ${flags.join(',')}`)
    this.change(path, uid, (m) => void (m.flags = [...(m.flags ?? []), ...flags]))
  }

  async removeFlags(path: string, uid: number, flags: string[]): Promise<void> {
    this.server.calls.push(`remove ${path} ${uid} ${flags.join(',')}`)
    this.change(path, uid, (m) => void (m.flags = (m.flags ?? []).filter((f) => !flags.includes(f))))
  }

  async moveMessages(from: string, to: string, uids: number[]): Promise<null> {
    this.server.calls.push(`move ${from} > ${to} ${uids.join(',')}`)
    const moved = (this.mailbox[from] ?? []).filter((m) => uids.includes(m.uid))
    this.mailbox[from] = (this.mailbox[from] ?? []).filter((m) => !uids.includes(m.uid))
    this.mailbox[to] = [...(this.mailbox[to] ?? []), ...moved]
    return null
  }

  async deleteMessages(path: string, uids: number[]): Promise<void> {
    this.server.calls.push(`delete ${path} ${uids.join(',')}`)
    this.mailbox[path] = (this.mailbox[path] ?? []).filter((m) => !uids.includes(m.uid))
  }

  async appendMessage(path: string): Promise<number> {
    this.server.calls.push(`append ${path}`)
    return 1
  }

  private change(path: string, uid: number, apply: (message: FakeMessage) => void): void {
    const found = (this.mailbox[path] ?? []).find((m) => m.uid === uid)
    if (found) apply(found)
  }
}

function toFetched(message: FakeMessage): FetchedMessage {
  return {
    uid: message.uid,
    flags: message.flags ?? [],
    size: 100,
    hasAttachment: false,
    envelope: {
      subject: message.subject ?? `s${message.uid}`,
      messageId: message.messageId,
      inReplyTo: message.inReplyTo,
      date: message.date,
      from: [{ address: 'sender@example.net' }]
    }
  }
}

/** The address book of the device: who is in it, whether the user allowed reading it, and what they answer when asked. */
export class FakeContacts implements DeviceContacts {
  people: Contact[] = []
  allowed = false
  /** What the user answers when asked for the permission. */
  answer = true
  asked = 0

  async permitted(): Promise<boolean> {
    return this.allowed
  }

  async ensurePermission(): Promise<boolean> {
    if (this.allowed) return true
    this.asked++
    this.allowed = this.answer
    return this.allowed
  }

  async search(typed: string, limit: number): Promise<Contact[]> {
    if (!this.allowed) return []
    const part = typed.trim().toLowerCase()
    return this.people
      .filter((person) => person.name.toLowerCase().includes(part) || person.address.toLowerCase().includes(part))
      .slice(0, limit)
  }
}

/** The screen lock of the device: whether there is one, what the user answers when asked for it, and what was asked. */
export class FakeDeviceLock implements DeviceLock {
  hasLock = true
  /** What the user does when asked: gives the lock (true) or cancels (false). */
  answer = true
  asked = 0
  secure = false

  async available(): Promise<boolean> {
    return this.hasLock
  }

  async authenticate(): Promise<boolean> {
    this.asked++
    return this.hasLock && this.answer
  }

  async setSecure(on: boolean): Promise<void> {
    this.secure = on
  }
}

/** The print service of the device: what was printed, and whether it can. */
export class FakePrinter implements Printer {
  readonly printed: Array<{ jobName: string; html: string }> = []
  failWith: Error | null = null

  async print(jobName: string, html: string): Promise<void> {
    if (this.failWith) throw this.failWith
    this.printed.push({ jobName, html })
  }
}

/** The device's files, which keeps what it was asked to do and answers as it is told to. */
export class FakeFiles implements Files {
  readonly picked: PickedFile[] = []
  readonly stored = new Map<string, Uint8Array>()
  readonly removed: string[] = []
  /** What the last sweep was told to keep, or null when there was none. */
  kept: string[] | null = null
  readonly saved: { name: string; contentType: string; content: Uint8Array }[] = []
  readonly opened: { name: string; contentType: string; content: Uint8Array }[] = []
  /** What the user chooses in the dialog for saving: true to save, false to cancel. */
  saveAnswer = true
  failWith: Error | null = null
  /** What another application asked of the application, which is given once. */
  incoming: Incoming | null = null

  async consumeIncoming(): Promise<Incoming | null> {
    const asked = this.incoming
    this.incoming = null
    return asked
  }

  async pick(): Promise<PickedFile[]> {
    return [...this.picked]
  }

  /** What was stashed, by the path of its copy. */
  readonly stashed: PickedFile[] = []
  private copies = 0

  async stash(name: string, contentType: string, content: Uint8Array): Promise<PickedFile> {
    if (this.failWith) throw this.failWith
    const file: PickedFile = { path: `/store/stash-${++this.copies}/${name}`, name, size: content.length, contentType }
    this.stored.set(file.path, content)
    this.stashed.push(file)
    return file
  }

  async read(path: string): Promise<Uint8Array> {
    const content = this.stored.get(path)
    if (!content) throw new Error(`No such file: ${path}`)
    return content
  }

  async remove(paths: string[]): Promise<void> {
    this.removed.push(...paths)
  }

  async keepOnly(paths: string[]): Promise<void> {
    this.kept = [...paths]
  }

  async save(name: string, contentType: string, content: Uint8Array): Promise<boolean> {
    if (this.failWith) throw this.failWith
    this.saved.push({ name, contentType, content })
    return this.saveAnswer
  }

  async open(name: string, contentType: string, content: Uint8Array): Promise<void> {
    if (this.failWith) throw this.failWith
    this.opened.push({ name, contentType, content })
  }
}

/** The device's notifications, which keeps what it was asked to show and answers as it is told to. */
export class FakeNotifications implements Notifications {
  readonly shown: MailNotification[] = []
  cleared = 0
  /** Whether notifications are allowed now, and whether the user will allow them when asked. */
  allowed = false
  willAllow = true
  /** The messages taps led to, given out one at a time. */
  readonly launchTargets: MessageTarget[] = []

  async permitted(): Promise<boolean> {
    return this.allowed
  }

  async ensurePermission(): Promise<boolean> {
    if (!this.allowed && this.willAllow) this.allowed = true
    return this.allowed
  }

  async show(notification: MailNotification): Promise<void> {
    this.shown.push(notification)
  }

  async clearAll(): Promise<void> {
    this.cleared += 1
  }

  async consumeLaunchTarget(): Promise<MessageTarget | null> {
    return this.launchTargets.shift() ?? null
  }
}

/** The push service of the system, which keeps what was registered and writes down what it was told. */
export class FakePush implements PushDevice {
  readonly calls: string[] = []
  /** What is registered now, by source id. */
  readonly sources = new Map<string, PushSource>()
  /** Whether the device has a push service of the system. */
  present = true
  /** Whether the user switched on the application's own connections, which count where there is no service of the system. */
  keepConnection = false
  failWith: Error | null = null

  private record(call: string): Promise<void> {
    if (this.failWith) return Promise.reject(this.failWith)
    this.calls.push(call)
    return Promise.resolve()
  }

  available(): Promise<boolean> {
    return Promise.resolve(this.present || this.keepConnection)
  }

  state(): Promise<PushState> {
    return Promise.resolve({ system: this.present, keepConnection: this.keepConnection })
  }

  async setKeepConnection(on: boolean): Promise<void> {
    await this.record(`keepConnection ${on}`)
    this.keepConnection = on
    // What the application kept for itself goes when it is switched off.
    if (!on && !this.present) this.sources.clear()
  }

  openBatterySettings(): Promise<void> {
    return this.record('openBatterySettings')
  }

  async register(source: PushSource): Promise<void> {
    await this.record(`register ${source.sourceId}`)
    this.sources.set(source.sourceId, source)
  }

  async unregister(sourceId: string): Promise<void> {
    await this.record(`unregister ${sourceId}`)
    this.sources.delete(sourceId)
  }

  async unregisterAll(): Promise<void> {
    await this.record('unregisterAll')
    this.sources.clear()
  }
}

/** The platform's schedule, which writes down what it was told. */
export class FakeSyncSchedule implements SyncSchedule {
  readonly calls: string[] = []
  failWith: Error | null = null

  private record(call: string): Promise<void> {
    if (this.failWith) return Promise.reject(this.failWith)
    this.calls.push(call)
    return Promise.resolve()
  }

  schedule(minutes: number): Promise<void> {
    return this.record(`schedule ${minutes}`)
  }

  cancel(): Promise<void> {
    return this.record('cancel')
  }

  runNow(): Promise<void> {
    return this.record('runNow')
  }
}

export const account = (name: string, over: Partial<NewAccount> = {}): NewAccount => ({
  displayName: name,
  emailAddress: `${name}@example.org`,
  imapHost: 'imap.example.org',
  imapPort: 993,
  imapSecure: 'tls',
  imapUsername: name,
  smtpHost: 'smtp.example.org',
  smtpPort: null,
  smtpSecure: null,
  smtpUsername: null,
  password: 'secret',
  smtpPassword: null,
  ...over
})

/**
 * The application on a real database and a fake world: mail servers, files and a sending server. What
 * the controllers do is shown by what is on the store and what the fake servers were told.
 */
export async function appHarness() {
  const { db, raw } = await migratedDatabase()
  // A message goes at once, as the tests of sending expect; the ones about taking a message back set the time they need.
  await saveSendSettings(db, { undoSeconds: 0 })
  const server = new FakeMailServer()
  const files = new FakeFiles()
  const deviceContacts = new FakeContacts()
  const deviceLock = new FakeDeviceLock()
  // The tests run in German, whatever the machine they run on is set to.
  useSystemLanguages(() => ['de'])
  language.apply('system')
  const printer = new FakePrinter()
  const smtp = new FakeSmtpServer()
  const notifications = new FakeNotifications()
  const syncSchedule = new FakeSyncSchedule()
  const push = new FakePush()
  const logs: string[] = []
  const platform: Platform = {
    connectImap: async (login) => server.connect(login) as unknown as ImapSession,
    makeTransport: () => smtp.transport,
    files,
    deviceContacts,
    deviceLock,
    printer,
    notifications,
    syncSchedule,
    push,
    log: { warn: (message) => logs.push(message), error: (message) => logs.push(message) }
  }
  const store = new AppStore()
  const reconnectTimers = new FakeTimers()
  const app: Application = createApplication(db, platform, store, reconnectTimers)

  /** An account with the mail it has on the server, fetched into the database as if it had been opened. */
  async function givenAccount(name: string, mailbox: Mailbox, over: Partial<NewAccount> = {}): Promise<Account> {
    server.addUser(name, mailbox)
    const added = await addAccount(db, account(name, over), { now: server.mailboxes.size })
    await app.identities.load()
    const entries = await (server.connect({ username: name } as ImapLogin).listMailboxes())
    const folders = await syncFolders(db, added.id, entries)
    for (const folder of folders) await saveMessages(db, folder, (mailbox[folder.imapPath] ?? []).map(toFetched))
    server.calls.length = 0
    server.sessions.length = 0
    return added
  }

  const folderOf = (folders: Folder[], path: string): Folder => folders.find((f) => f.imapPath === path) as Folder

  return { app, store, db, raw, server, files, deviceContacts, deviceLock, printer, smtp, notifications, syncSchedule, push, logs, reconnectTimers, givenAccount, folderOf }
}

/**
 * Waits until what is checked holds, for what the application does on the side, such as marking a
 * message read while its text is being fetched. Gives up with the last failure after half a second.
 */
export async function eventually(check: () => void | Promise<void>, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      await check()
      return
    } catch (error) {
      if (Date.now() > deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
}
