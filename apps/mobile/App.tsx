import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { shouldWarnAboutAttachment } from '@peregrine/core/attachmentHints'
import { refusalForOpening } from '@peregrine/core/attachmentSafety'
import { SNIFF_BYTES } from '@peregrine/core/fileType'
import type { ImapSession } from '@peregrine/core/imapSession'
import type { QueueRunner } from '@peregrine/core/offlineQueue'
import type { PendingSummary } from '@peregrine/core/pendingActions'
import type { SecureMode } from '@peregrine/core/types'
import type { SqlDb } from '@peregrine/core/sqlDb'
import { ImapClientSession } from '@peregrine/imap/session'
import { addAccount, getAccount, listAccounts, removeAccount, type Account } from './src/accounts'
import { openDatabase } from './src/database'
import { attachmentContent, listAttachments, type AttachmentInfo } from './src/attachments'
import { formatSize, refusalText, riskText } from './src/attachmentText'
import { attachPicked, detachFile, emptyDraft, hasRecipient, replyDraft, toComposeInput, type Draft } from './src/draft'
import { MAX_ATTACHMENT_BYTES, type Files } from './src/files'
import { Connections } from './src/connections'
import { getFolder, listFolders, syncFolders, type Folder } from './src/folders'
import { MailActions } from './src/mailActions'
import { listMessages, type StoredMessage } from './src/messages'
import { readMessage, type ReadableMessage } from './src/messageText'
import { createFiles, createTransport } from './src/native'
import { createQueue } from './src/queue'
import { sendAndFile, smtpSettingsOf } from './src/send'
import { syncFolder } from './src/sync'
import { listUnified, refreshInboxes, type RefreshResult, type UnifiedMessage } from './src/unified'

/**
 * The prototype of stages 4 and 5: any number of accounts, the folders of one, the messages of a
 * folder, one message opened, answered, marked, moved or deleted, and a new one written. Everything
 * that changes mail goes through the offline queue, so the screens work the same without a
 * connection: what was decided shows at once and reaches the server when there is one again. The
 * screens are as plain as they can be and are meant to be thrown away. What is being tried is
 * everything underneath them.
 */

type Screen =
  | { name: 'loading' }
  | { name: 'accounts'; accounts: Account[]; error?: string }
  | { name: 'login'; error?: string }
  | { name: 'unified'; messages: UnifiedMessage[]; busy: boolean; problems: RefreshResult[] }
  | { name: 'folders'; account: Account; folders: Folder[]; offline?: string }
  | {
      name: 'messages'
      account: Account
      folder: Folder
      messages: StoredMessage[]
      names: Record<string, string>
      busy: boolean
      error?: string
    }
  | {
      name: 'message'
      account: Account
      folder: Folder
      summary: StoredMessage
      /** Where it was opened from, and so where leaving it goes back to. */
      origin: 'folder' | 'unified'
      message?: ReadableMessage
      /** The source of the message and the attachments found in it, for saving and opening them. */
      source?: Uint8Array
      attachments?: AttachmentInfo[]
      /** What was said about the last thing done with an attachment. */
      notice?: string
      error?: string
    }
  | {
      name: 'move'
      account: Account
      folder: Folder
      summary: StoredMessage
      origin: 'folder' | 'unified'
      message?: ReadableMessage
      targets: Folder[]
    }
  | { name: 'compose'; account: Account; back: Screen; draft: Draft; busy: boolean; error?: string }

/** What the form asks for: the way into one mailbox, and out of it. */
interface AccountForm {
  email: string
  host: string
  port: number
  secure: SecureMode
  username: string
  password: string
  smtpHost: string
  smtpPort: number
  smtpSecure: SecureMode
}

type Login = Pick<AccountForm, 'host' | 'port' | 'secure' | 'username' | 'password'>

const formOf = (account: Account): AccountForm => ({
  email: account.emailAddress,
  host: account.imapHost,
  port: account.imapPort,
  secure: account.imapSecure,
  username: account.imapUsername,
  password: account.password,
  smtpHost: account.smtpHost ?? '',
  smtpPort: account.smtpPort ?? 587,
  smtpSecure: account.smtpSecure ?? 'starttls'
})

const loginOf = (account: Account): Login => ({
  host: account.imapHost,
  port: account.imapPort,
  secure: account.imapSecure,
  username: account.imapUsername,
  password: account.password
})

/** Connects, or throws with the reason. */
async function connectWith(login: Login): Promise<ImapSession> {
  const session = new ImapClientSession(login, { transport: createTransport() })
  await session.connect()
  return session
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The attachments of a message. A message that cannot be read for them is shown without, and not refused. */
function attachmentsOf(source: Uint8Array): AttachmentInfo[] {
  try {
    return listAttachments(source)
  } catch (error) {
    console.error('reading the attachments failed:', describe(error))
    return []
  }
}

const SEEN = '\\Seen'
const FLAGGED = '\\Flagged'

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'loading' })
  /** The accounts that have a connection now. */
  const [connected, setConnected] = useState<string[]>([])
  const [waiting, setWaiting] = useState<{ summary: PendingSummary; problem: string | null } | null>(null)
  const database = useRef<SqlDb | null>(null)
  const queue = useRef<QueueRunner | null>(null)
  const mail = useRef<MailActions | null>(null)
  const files = useRef<Files | null>(null)
  /** A connection per account, which belongs to the application and not to a screen. */
  const connections = useRef<Connections | null>(null)
  const latest = useRef<Screen>(screen)
  latest.current = screen
  // What was typed last, so a failed sign-in does not make anybody type it all again.
  const attempt = useRef<AccountForm | undefined>(undefined)
  /** The account whose queue the status line speaks of. */
  const shown = useRef<string | null>(null)

  const refreshWaiting = useCallback(async () => {
    const actions = mail.current
    if (!actions) return
    const summary = await actions.waiting()
    const problem = shown.current ? await actions.lastProblem(shown.current) : null
    setWaiting({ summary, problem })
  }, [])

  /** The list of accounts, or the form when there is none. */
  const showAccounts = useCallback(async (error?: string) => {
    const db = database.current
    if (!db) return
    shown.current = null
    const accounts = await listAccounts(db)
    setScreen(accounts.length === 0 ? { name: 'login', error } : { name: 'accounts', accounts, error })
  }, [])

  /** With a connection that works: replays what waited for one, takes the folders from the server. */
  const showFolders = useCallback(
    async (account: Account, imap: ImapSession) => {
      const db = database.current
      if (!db) return
      shown.current = account.id
      await mail.current?.flush(account.id)
      await syncFolders(db, account.id, await imap.listMailboxes())
      setScreen({ name: 'folders', account, folders: await listFolders(db, account.id) })
      void refreshWaiting()
    },
    [refreshWaiting]
  )

  const openAccount = useCallback(
    async (account: Account) => {
      const db = database.current
      setScreen({ name: 'loading' })
      shown.current = account.id
      try {
        await showFolders(account, await (connections.current as Connections).ensure(account))
      } catch (error) {
        // What was fetched before is still there to read, and what is decided now waits for a connection.
        const folders = db ? await listFolders(db, account.id) : []
        if (folders.length > 0) {
          setScreen({ name: 'folders', account, folders, offline: describe(error) })
          void refreshWaiting()
        } else await showAccounts(`${account.displayName}: ${describe(error)}`)
      }
    },
    [refreshWaiting, showAccounts, showFolders]
  )

  /**
   * The newest messages of every account's inbox in one list. It is shown at once from what is stored
   * and brought up to date after, account by account, so a server that is down costs a line saying
   * so and not the list.
   */
  const showUnified = useCallback(
    async (options: { refresh: boolean }) => {
      const db = database.current
      const all = connections.current
      const actions = mail.current
      if (!db || !all || !actions) return
      shown.current = null
      const show = async (busy: boolean, problems: RefreshResult[], navigating: boolean) => {
        const messages = await listUnified(db)
        // Going to the list always shows it. The update after the fetch only goes onto the list: not
        // over a screen the user has moved on to while the accounts were being fetched.
        if (navigating || latest.current.name === 'unified') {
          setScreen({ name: 'unified', messages, busy, problems })
        }
      }
      await show(options.refresh, [], true)
      if (!options.refresh) return
      const results = await refreshInboxes({ db, connections: all, mail: actions }, await listAccounts(db))
      await show(false, results.filter((result) => result.error !== undefined), false)
      void refreshWaiting()
    },
    [refreshWaiting]
  )

  /** The first screen: the unified inbox when there are accounts to unify, the one account when there is one. */
  const showStart = useCallback(
    async (accounts: Account[]) => {
      if (accounts.length >= 2) await showUnified({ refresh: true })
      else if (accounts.length === 1) await openAccount(accounts[0])
      else await showAccounts()
    },
    [openAccount, showAccounts, showUnified]
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const db = await openDatabase()
        database.current = db
        const log = { warn: (message: string) => console.warn(message), error: (message: string) => console.error(message) }
        connections.current = new Connections(
          (account) => connectWith(loginOf(account)),
          () => setConnected((connections.current as Connections).connectedIds)
        )
        const runner = createQueue(db, { changed: () => refreshWaiting(), log })
        files.current = createFiles()
        runner.setSendHandler((input, imap) =>
          sendAndFile(db, { makeTransport: createTransport, files: files.current ?? undefined }, input, imap, log)
        )
        queue.current = runner
        mail.current = new MailActions({
          db,
          queue: runner,
          session: (accountId) => (connections.current as Connections).get(accountId),
          log
        })
        const accounts = await listAccounts(db)
        if (cancelled) return
        await showStart(accounts)
      } catch (error) {
        if (!cancelled) setScreen({ name: 'login', error: describe(error) })
      }
    })()
    return () => {
      cancelled = true
      queue.current?.stop()
      connections.current?.dropAll()
    }
  }, [refreshWaiting, showStart])

  /** The messages of a folder from the database, and a sync with the server when there is one. */
  const showMessages = async (account: Account, folder: Folder, options: { sync: boolean }) => {
    const db = database.current
    if (!db) return
    const names = Object.fromEntries((await listFolders(db, account.id)).map((f) => [f.id, f.displayName]))
    const show = async (busy: boolean, error?: string) =>
      setScreen({ name: 'messages', account, folder, messages: await listMessages(db, folder.id), names, busy, error })
    const imap = connections.current?.get(account.id) ?? null
    if (!options.sync || !imap) {
      await show(false, options.sync ? 'Keine Verbindung. Gezeigt wird, was schon geladen ist.' : undefined)
      return
    }
    await show(true)
    try {
      await syncFolder(imap, db, folder)
      await show(false)
    } catch (error) {
      await show(false, describe(error))
    }
  }

  const openMessage = async (account: Account, folder: Folder, summary: StoredMessage, origin: 'folder' | 'unified') => {
    setScreen({ name: 'message', account, folder, summary, origin })
    // Opening it reads it. The change is made here at once and told to the server through the queue.
    if (!summary.flags.includes(SEEN)) {
      mail.current?.setFlags(folder, [summary.uid], [SEEN], []).catch((error) => console.error(describe(error)))
    }
    try {
      // Reading needs the server: the account is connected if it is not, and says why if it cannot be.
      const imap = await (connections.current as Connections).ensure(account)
      const full = await imap.fetchFullMessage(folder.imapPath, summary.uid)
      if (!full) throw new Error('Die Nachricht gibt es auf dem Server nicht mehr')
      setScreen({
        name: 'message',
        account,
        folder,
        summary,
        origin,
        message: readMessage(full.source),
        source: full.source,
        attachments: attachmentsOf(full.source)
      })
    } catch (error) {
      setScreen({ name: 'message', account, folder, summary, origin, error: describe(error) })
    }
  }

  /** Runs an action on the open message, then shows the folder again, where its effect is to be seen. */
  const act = async (
    from: Extract<Screen, { name: 'message' | 'move' }>,
    action: (actions: MailActions) => Promise<void>
  ) => {
    try {
      if (mail.current) await action(mail.current)
    } catch (error) {
      console.error(describe(error))
    }
    await leave(from)
  }

  /** Back from a message to the list it was opened from, which shows what was done to it. */
  const leave = async (from: Extract<Screen, { name: 'message' | 'move' }>) => {
    if (from.origin === 'unified') await showUnified({ refresh: false })
    else await showMessages(from.account, from.folder, { sync: false })
  }

  const toggleFlag = async (current: Extract<Screen, { name: 'message' }>, flag: string, on: boolean) => {
    const db = database.current
    if (!db || !mail.current) return
    await mail.current.setFlags(current.folder, [current.summary.uid], on ? [flag] : [], on ? [] : [flag])
    const fresh = (await listMessages(db, current.folder.id)).find((m) => m.uid === current.summary.uid)
    if (fresh) setScreen({ ...current, summary: fresh })
  }

  const openFromUnified = async (message: UnifiedMessage) => {
    const db = database.current
    if (!db) return
    const account = await getAccount(db, message.accountId)
    const folder = await getFolder(db, message.folderId)
    if (account && folder) await openMessage(account, folder, message, 'unified')
  }

  /** Saves an attachment where the user chooses. The decision to keep a file is theirs, so there is no check. */
  const saveAttachment = async (current: Extract<Screen, { name: 'message' }>, info: AttachmentInfo) => {
    const content = current.source ? attachmentContent(current.source, info.id) : undefined
    if (!content || !files.current) return
    try {
      const saved = await files.current.save(info.filename, info.contentType, content)
      setScreen({ ...current, notice: saved ? `Gespeichert: ${info.filename}` : undefined })
    } catch (error) {
      setScreen({ ...current, notice: `Speichern ging nicht: ${describe(error)}` })
    }
  }

  /** Hands an attachment to another application, unless it would start a program or is not what its name says. */
  const openAttachment = async (current: Extract<Screen, { name: 'message' }>, info: AttachmentInfo) => {
    const content = current.source ? attachmentContent(current.source, info.id) : undefined
    if (!content || !files.current) return
    const refused = refusalForOpening(info.filename, content.subarray(0, SNIFF_BYTES))
    if (refused) {
      setScreen({ ...current, notice: refusalText(refused) })
      return
    }
    try {
      await files.current.open(info.filename, info.contentType, content)
      setScreen({ ...current, notice: undefined })
    } catch (error) {
      setScreen({ ...current, notice: `Öffnen ging nicht: ${describe(error)}` })
    }
  }

  /** Leaving the compose screen without sending: what was attached was copied for this message and goes. */
  const cancelCompose = async (current: Extract<Screen, { name: 'compose' }>, draft: Draft) => {
    await files.current?.remove(draft.attachments.map((attached) => attached.path)).catch(() => undefined)
    setScreen(current.back)
  }

  const startMove = async (current: Extract<Screen, { name: 'message' }>) => {
    const db = database.current
    if (!db) return
    const targets = (await listFolders(db, current.account.id)).filter((f) => f.id !== current.folder.id)
    setScreen({ ...current, name: 'move', targets })
  }

  const startCompose = (account: Account, back: Screen, draft: Draft) => {
    setScreen({ name: 'compose', account, back, draft, busy: false })
  }

  const send = async (current: Extract<Screen, { name: 'compose' }>, draft: Draft) => {
    const problem = !current.account.emailAddress
      ? 'Zu diesem Konto gibt es keine Absenderadresse.'
      : !smtpSettingsOf(current.account)
        ? 'Zu diesem Konto ist kein Server zum Senden eingetragen.'
        : null
    if (problem) {
      setScreen({ ...current, draft, error: problem })
      return
    }
    setScreen({ ...current, draft, busy: true, error: undefined })
    try {
      await mail.current?.send(toComposeInput(current.account.id, draft))
      setScreen(current.back)
      void refreshWaiting()
    } catch (error) {
      setScreen({ ...current, draft, busy: false, error: describe(error) })
    }
  }

  const removeCurrent = async (account: Account) => {
    connections.current?.drop(account.id)
    if (database.current) await removeAccount(database.current, account.id)
    await showAccounts()
  }

  /** A new account is kept only once it has connected. A mistyped server would otherwise be tried at every start. */
  const signIn = async (form: AccountForm) => {
    const db = database.current
    if (!db) return
    attempt.current = form
    setScreen({ name: 'loading' })
    try {
      const session = await connectWith(form)
      const email = form.email.trim() || (form.username.includes('@') ? form.username : '')
      const account = await addAccount(db, {
        displayName: email || form.username,
        emailAddress: email,
        imapHost: form.host,
        imapPort: form.port,
        imapSecure: form.secure,
        imapUsername: form.username,
        smtpHost: form.smtpHost.trim() || null,
        smtpPort: form.smtpHost.trim() ? form.smtpPort : null,
        smtpSecure: form.smtpHost.trim() ? form.smtpSecure : null,
        smtpUsername: null,
        password: form.password,
        smtpPassword: null
      })
      connections.current?.adopt(account.id, session)
      await showFolders(account, session)
    } catch (error) {
      setScreen({ name: 'login', error: describe(error) })
    }
  }

  const atAccount = screen.name === 'unified' || screen.name === 'folders' || screen.name === 'messages' || screen.name === 'message' || screen.name === 'move'

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={styles.page}>
        {atAccount && (
          <StatusLine
            online={shown.current === null ? connected.length > 0 : connected.includes(shown.current)}
            waiting={waiting}
            onDiscard={async () => {
              await mail.current?.discardFailed()
              await refreshWaiting()
            }}
          />
        )}
        {screen.name === 'loading' && <ActivityIndicator style={styles.centered} size="large" />}
        {screen.name === 'accounts' && (
          <Accounts
            accounts={screen.accounts}
            error={screen.error}
            onOpen={openAccount}
            onAdd={() => setScreen({ name: 'login' })}
            onUnified={() => showUnified({ refresh: true })}
          />
        )}
        {screen.name === 'unified' && (
          <Unified
            screen={screen}
            onAccounts={() => void showAccounts()}
            onRefresh={() => showUnified({ refresh: true })}
            onOpen={openFromUnified}
          />
        )}
        {screen.name === 'login' && (
          <Login
            error={screen.error}
            initial={attempt.current}
            onSubmit={signIn}
            onCancel={async () => {
              const accounts = database.current ? await listAccounts(database.current) : []
              if (accounts.length > 0) await showAccounts()
            }}
          />
        )}
        {screen.name === 'folders' && (
          <Folders
            account={screen.account}
            folders={screen.folders}
            offline={screen.offline}
            onOpen={(folder) => showMessages(screen.account, folder, { sync: true })}
            onBack={() => void showAccounts()}
            onRemove={() => removeCurrent(screen.account)}
            onConnect={() => openAccount(screen.account)}
            onCompose={() => startCompose(screen.account, screen, emptyDraft)}
          />
        )}
        {screen.name === 'messages' && (
          <Messages
            screen={screen}
            onBack={async () => {
              const db = database.current
              if (db) setScreen({ name: 'folders', account: screen.account, folders: await listFolders(db, screen.account.id) })
            }}
            onOpen={(summary) => openMessage(screen.account, screen.folder, summary, 'folder')}
          />
        )}
        {screen.name === 'message' && (
          <MessageView
            screen={screen}
            onBack={() => leave(screen)}
            onReply={() =>
              screen.message && startCompose(screen.account, screen, replyDraft(screen.message))
            }
            onToggleSeen={() => act(screen, (a) => a.setFlags(screen.folder, [screen.summary.uid], [], [SEEN]))}
            onToggleFlag={() => toggleFlag(screen, FLAGGED, !screen.summary.flags.includes(FLAGGED))}
            onMove={() => startMove(screen)}
            onSave={(info) => saveAttachment(screen, info)}
            onOpenAttachment={(info) => openAttachment(screen, info)}
            onDelete={() => act(screen, (a) => a.remove(screen.folder, [screen.summary.uid]))}
          />
        )}
        {screen.name === 'move' && (
          <MoveTo
            targets={screen.targets}
            onChoose={(target) => act(screen, (a) => a.move(screen.folder, [screen.summary.uid], target))}
            onBack={() => setScreen({ ...screen, name: 'message' })}
          />
        )}
        {screen.name === 'compose' && (
          <Compose
            screen={screen}
            files={files.current as Files}
            onSend={(draft) => send(screen, draft)}
            onCancel={(draft) => cancelCompose(screen, draft)}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

/** Whether there is a connection, and what waits for one. A failure is said, with its reason. */
function StatusLine(props: {
  online: boolean
  waiting: { summary: PendingSummary; problem: string | null } | null
  onDiscard: () => void
}) {
  const summary = props.waiting?.summary
  const open = (summary?.total ?? 0) - (summary?.failed ?? 0)
  const lines: string[] = []
  if (!props.online) lines.push('Keine Verbindung')
  if (open > 0) lines.push(open === 1 ? '1 Aktion wartet' : `${open} Aktionen warten`)
  if (lines.length === 0 && !summary?.failed) return null
  return (
    <View style={styles.status}>
      {lines.length > 0 ? <Text style={styles.statusText}>{lines.join(' · ')}</Text> : null}
      {props.waiting?.problem ? <Text style={styles.statusProblem}>{props.waiting.problem}</Text> : null}
      {summary?.failed ? (
        <Pressable onPress={props.onDiscard}>
          <Text style={styles.statusProblem}>
            {summary.failed === 1 ? '1 Aktion ist fehlgeschlagen.' : `${summary.failed} Aktionen sind fehlgeschlagen.`} Verwerfen
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}

function Accounts(props: {
  accounts: Account[]
  error?: string
  onOpen: (account: Account) => void
  onAdd: () => void
  onUnified: () => void
}) {
  return (
    <View style={styles.fill}>
      <Text style={styles.title}>Konten</Text>
      {props.accounts.length >= 2 ? <Button label="Alle Posteingänge" onPress={props.onUnified} /> : null}
      {props.error ? <Text style={styles.error}>{props.error}</Text> : null}
      <FlatList
        data={props.accounts}
        keyExtractor={(account) => account.id}
        renderItem={({ item }) => (
          <Pressable style={styles.item} onPress={() => props.onOpen(item)}>
            <Text style={styles.itemTitle}>{item.displayName}</Text>
            <Text style={styles.itemMeta}>{item.emailAddress || item.imapHost}</Text>
          </Pressable>
        )}
      />
      <Button label="Konto hinzufügen" onPress={props.onAdd} />
    </View>
  )
}

function Login(props: {
  error?: string
  initial?: AccountForm
  onSubmit: (form: AccountForm) => void
  onCancel: () => void
}) {
  const { initial } = props
  const [email, setEmail] = useState(initial?.email ?? '')
  const [host, setHost] = useState(initial?.host ?? '')
  const [port, setPort] = useState(String(initial?.port ?? 993))
  const [secure, setSecure] = useState<SecureMode>(initial?.secure ?? 'tls')
  const [username, setUsername] = useState(initial?.username ?? '')
  const [password, setPassword] = useState(initial?.password ?? '')
  const [smtpHost, setSmtpHost] = useState(initial?.smtpHost ?? '')
  const [smtpPort, setSmtpPort] = useState(String(initial?.smtpPort ?? 587))
  const [smtpSecure, setSmtpSecure] = useState<SecureMode>(initial?.smtpSecure ?? 'starttls')

  const choose = (mode: SecureMode) => {
    setSecure(mode)
    setPort(mode === 'tls' ? '993' : '143')
  }
  const chooseSmtp = (mode: SecureMode) => {
    setSmtpSecure(mode)
    setSmtpPort(mode === 'tls' ? '465' : '587')
  }
  const ready =
    host.trim() !== '' && username !== '' && password !== '' && Number(port) > 0 && (smtpHost.trim() === '' || Number(smtpPort) > 0)

  return (
    <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Peregrine</Text>
      <Text style={styles.hint}>Ein Konto per IMAP verbinden. Das Passwort bleibt verschlüsselt auf diesem Gerät.</Text>
      {props.error ? <Text style={styles.error}>{props.error}</Text> : null}
      <TextInput style={styles.input} placeholder="E-Mail-Adresse (alex@example.org)" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={email} onChangeText={setEmail} />
      <TextInput style={styles.input} placeholder="IMAP-Server (mail.example.org)" autoCapitalize="none" autoCorrect={false} value={host} onChangeText={setHost} />
      <View style={styles.row}>
        <Chip label="TLS" active={secure === 'tls'} onPress={() => choose('tls')} />
        <Chip label="STARTTLS" active={secure === 'starttls'} onPress={() => choose('starttls')} />
      </View>
      <TextInput style={styles.input} placeholder="Port" keyboardType="number-pad" value={port} onChangeText={setPort} />
      <TextInput style={styles.input} placeholder="Benutzername" autoCapitalize="none" autoCorrect={false} value={username} onChangeText={setUsername} />
      <TextInput style={styles.input} placeholder="Passwort" secureTextEntry autoCapitalize="none" value={password} onChangeText={setPassword} />
      <Text style={styles.hint}>Zum Senden (SMTP). Ohne Server lässt sich mit diesem Konto nur lesen. Benutzername und Passwort sind die gleichen.</Text>
      <TextInput style={styles.input} placeholder="SMTP-Server (smtp.example.org)" autoCapitalize="none" autoCorrect={false} value={smtpHost} onChangeText={setSmtpHost} />
      <View style={styles.row}>
        <Chip label="TLS" active={smtpSecure === 'tls'} onPress={() => chooseSmtp('tls')} />
        <Chip label="STARTTLS" active={smtpSecure === 'starttls'} onPress={() => chooseSmtp('starttls')} />
      </View>
      <TextInput style={styles.input} placeholder="SMTP-Port" keyboardType="number-pad" value={smtpPort} onChangeText={setSmtpPort} />
      <Button
        label="Verbinden"
        disabled={!ready}
        onPress={() =>
          props.onSubmit({
            email,
            host: host.trim(),
            port: Number(port),
            secure,
            username,
            password,
            smtpHost,
            smtpPort: Number(smtpPort),
            smtpSecure
          })
        }
      />
      <Pressable onPress={props.onCancel}>
        <Text style={styles.link}>‹ Zurück zu den Konten</Text>
      </Pressable>
    </ScrollView>
  )
}

function Unified(props: {
  screen: Extract<Screen, { name: 'unified' }>
  onAccounts: () => void
  onRefresh: () => void
  onOpen: (message: UnifiedMessage) => void
}) {
  const { screen } = props
  return (
    <View style={styles.fill}>
      <Pressable onPress={props.onAccounts}>
        <Text style={styles.link}>‹ Konten</Text>
      </Pressable>
      <Text style={styles.title}>Alle Posteingänge</Text>
      {screen.problems.map((problem) => (
        <Text key={problem.accountId} style={styles.error}>
          {problem.accountName}: {problem.error}
        </Text>
      ))}
      <FlatList
        data={screen.messages}
        keyExtractor={(message) => `${message.folderId}:${message.uid}`}
        refreshing={screen.busy}
        onRefresh={props.onRefresh}
        ListEmptyComponent={screen.busy ? undefined : <Text style={styles.hint}>Keine Nachrichten.</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.item} onPress={() => props.onOpen(item)}>
            <Text style={[styles.itemTitle, !item.flags.includes(SEEN) && styles.unread]} numberOfLines={1}>
              {item.flags.includes(FLAGGED) ? '★ ' : ''}
              {item.hasAttachment ? '📎 ' : ''}
              {item.subject || '(ohne Betreff)'}
            </Text>
            <Text style={styles.itemMeta} numberOfLines={1}>
              {item.accountName}  ·  {item.sender}
              {item.dateMs ? `  ·  ${new Date(item.dateMs).toLocaleDateString('de-DE')}` : ''}
            </Text>
            {item.pendingMoveTo ? <Text style={styles.pending}>wird verschoben, sobald es geht</Text> : null}
          </Pressable>
        )}
      />
    </View>
  )
}

function Folders(props: {
  account: Account
  folders: Folder[]
  offline?: string
  onOpen: (folder: Folder) => void
  onBack: () => void
  onRemove: () => void
  onConnect: () => void
  onCompose: () => void
}) {
  return (
    <View style={styles.fill}>
      <Pressable onPress={props.onBack}>
        <Text style={styles.link}>‹ Konten</Text>
      </Pressable>
      <Text style={styles.title}>{props.account.displayName}</Text>
      {props.offline ? (
        <View>
          <Text style={styles.error}>{props.offline}</Text>
          <Button label="Erneut verbinden" onPress={props.onConnect} />
        </View>
      ) : null}
      <FlatList
        data={props.folders}
        keyExtractor={(folder) => folder.id}
        renderItem={({ item }) => (
          <Pressable style={styles.item} onPress={() => props.onOpen(item)}>
            <Text style={styles.itemTitle}>{item.imapPath}</Text>
            {item.specialUse ? <Text style={styles.itemMeta}>{item.specialUse}</Text> : null}
          </Pressable>
        )}
      />
      <Button label="Neue Nachricht" onPress={props.onCompose} />
      <Button label="Konto entfernen" onPress={props.onRemove} />
    </View>
  )
}

function Messages(props: {
  screen: Extract<Screen, { name: 'messages' }>
  onBack: () => void
  onOpen: (summary: StoredMessage) => void
}) {
  const { screen } = props
  return (
    <View style={styles.fill}>
      <Pressable onPress={props.onBack}>
        <Text style={styles.link}>‹ Ordner</Text>
      </Pressable>
      <Text style={styles.title}>{screen.folder.displayName}</Text>
      {screen.busy ? <ActivityIndicator style={styles.spinner} /> : null}
      {screen.error ? <Text style={styles.error}>{screen.error}</Text> : null}
      <FlatList
        data={screen.messages}
        keyExtractor={(message) => String(message.uid)}
        ListEmptyComponent={screen.busy ? undefined : <Text style={styles.hint}>Keine Nachrichten.</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.item} onPress={() => props.onOpen(item)}>
            <Text style={[styles.itemTitle, !item.flags.includes(SEEN) && styles.unread]} numberOfLines={1}>
              {item.flags.includes(FLAGGED) ? '★ ' : ''}
              {item.hasAttachment ? '📎 ' : ''}
              {item.subject || '(ohne Betreff)'}
            </Text>
            <Text style={styles.itemMeta} numberOfLines={1}>
              {item.sender}
              {item.dateMs ? `  ·  ${new Date(item.dateMs).toLocaleDateString('de-DE')}` : ''}
            </Text>
            {item.pendingMoveTo ? (
              <Text style={styles.pending}>→ {screen.names[item.pendingMoveTo] ?? 'anderer Ordner'}, sobald es geht</Text>
            ) : null}
          </Pressable>
        )}
      />
    </View>
  )
}

function MessageView(props: {
  screen: Extract<Screen, { name: 'message' }>
  onBack: () => void
  onReply: () => void
  onToggleSeen: () => void
  onToggleFlag: () => void
  onMove: () => void
  onDelete: () => void
  onSave: (info: AttachmentInfo) => void
  onOpenAttachment: (info: AttachmentInfo) => void
}) {
  const { screen } = props
  const flagged = screen.summary.flags.includes(FLAGGED)
  return (
    <View style={styles.fill}>
      <Pressable onPress={props.onBack}>
        <Text style={styles.link}>‹ Zurück</Text>
      </Pressable>
      <Text style={styles.title}>{screen.message?.subject || screen.summary.subject || '(ohne Betreff)'}</Text>
      <Text style={styles.itemMeta}>{screen.message?.from || screen.summary.sender}</Text>
      <View style={styles.actions}>
        <Chip label="Antworten" active={false} onPress={props.onReply} disabled={!screen.message} />
        <Chip label="Ungelesen" active={false} onPress={props.onToggleSeen} />
        <Chip label={flagged ? '★ Markiert' : '☆ Markieren'} active={flagged} onPress={props.onToggleFlag} />
        <Chip label="Verschieben" active={false} onPress={props.onMove} />
        <Chip label="Löschen" active={false} onPress={props.onDelete} />
      </View>
      {screen.error ? <Text style={styles.error}>{screen.error}</Text> : null}
      {!screen.message && !screen.error ? <ActivityIndicator style={styles.spinner} /> : null}
      <ScrollView style={styles.fill}>
        <Text selectable style={styles.body}>
          {screen.message?.text ?? ''}
        </Text>
        {screen.attachments && screen.attachments.length > 0 ? (
          <View style={styles.attachments}>
            <Text style={styles.itemMeta}>Anhänge</Text>
            {screen.attachments.map((info) => (
              <View key={info.id} style={styles.attachment}>
                <Text style={styles.itemTitle}>📎 {info.filename}</Text>
                <Text style={styles.itemMeta}>
                  {info.contentType} · {formatSize(info.size)}
                </Text>
                {info.findings.map((finding) => (
                  <Text key={finding.risk} style={styles.error}>
                    {riskText(finding)}
                  </Text>
                ))}
                <View style={styles.row}>
                  <Chip label="Speichern" active={false} onPress={() => props.onSave(info)} />
                  <Chip label="Öffnen" active={false} onPress={() => props.onOpenAttachment(info)} />
                </View>
              </View>
            ))}
          </View>
        ) : null}
        {screen.notice ? <Text style={styles.hint}>{screen.notice}</Text> : null}
      </ScrollView>
    </View>
  )
}

function MoveTo(props: { targets: Folder[]; onChoose: (target: Folder) => void; onBack: () => void }) {
  return (
    <View style={styles.fill}>
      <Pressable onPress={props.onBack}>
        <Text style={styles.link}>‹ Zurück</Text>
      </Pressable>
      <Text style={styles.title}>Verschieben nach</Text>
      <FlatList
        data={props.targets}
        keyExtractor={(folder) => folder.id}
        renderItem={({ item }) => (
          <Pressable style={styles.item} onPress={() => props.onChoose(item)}>
            <Text style={styles.itemTitle}>{item.displayName}</Text>
          </Pressable>
        )}
      />
    </View>
  )
}

function Compose(props: {
  screen: Extract<Screen, { name: 'compose' }>
  files: Files
  onSend: (draft: Draft) => void
  onCancel: (draft: Draft) => void
}) {
  const { screen } = props
  const [draft, setDraft] = useState<Draft>(screen.draft)
  const [notice, setNotice] = useState<string | null>(null)
  const [warned, setWarned] = useState(false)
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }))

  const pick = async () => {
    try {
      const picked = await props.files.pick()
      if (picked.length === 0) return
      const { attachments, refused } = await attachPicked(draft.attachments, picked, props.files)
      set({ attachments })
      setNotice(
        refused.length > 0
          ? `Nicht angehängt, weil es zu groß ist (insgesamt höchstens ${formatSize(MAX_ATTACHMENT_BYTES)}): ${refused.map((file) => file.name).join(', ')}`
          : null
      )
    } catch (error) {
      setNotice(`Anhängen ging nicht: ${describe(error)}`)
    }
  }

  const detach = async (path: string) => {
    set({ attachments: await detachFile(draft.attachments, path, props.files) })
  }

  // A message that talks of an attachment and has none is held back once, and goes the second time.
  const forgotten = shouldWarnAboutAttachment(draft.body, draft.attachments.length)
  const press = () => {
    if (forgotten && !warned) {
      setWarned(true)
      return
    }
    props.onSend(draft)
  }

  return (
    <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
      <Pressable onPress={() => props.onCancel(draft)}>
        <Text style={styles.link}>‹ Abbrechen</Text>
      </Pressable>
      <Text style={styles.title}>Neue Nachricht</Text>
      <Text style={styles.itemMeta}>Von {screen.account.emailAddress || screen.account.displayName}</Text>
      {screen.error ? <Text style={styles.error}>{screen.error}</Text> : null}
      <TextInput style={styles.input} placeholder="An" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={draft.to} onChangeText={(to) => set({ to })} />
      <TextInput style={styles.input} placeholder="Kopie" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={draft.cc} onChangeText={(cc) => set({ cc })} />
      <TextInput style={styles.input} placeholder="Betreff" value={draft.subject} onChangeText={(subject) => set({ subject })} />
      <TextInput style={[styles.input, styles.multiline]} placeholder="Nachricht" multiline textAlignVertical="top" value={draft.body} onChangeText={(body) => set({ body })} />
      {draft.attachments.map((attached) => (
        <View key={attached.path} style={styles.attachment}>
          <Text style={styles.itemTitle}>📎 {attached.filename}</Text>
          <Text style={styles.itemMeta}>{formatSize(attached.size)}</Text>
          <Pressable onPress={() => detach(attached.path)}>
            <Text style={styles.link}>Entfernen</Text>
          </Pressable>
        </View>
      ))}
      {notice ? <Text style={styles.error}>{notice}</Text> : null}
      <Chip label="Datei anhängen" active={false} onPress={pick} />
      {forgotten && warned ? (
        <Text style={styles.error}>Du schreibst von einem Anhang, aber es ist keiner angehängt. Tippe noch einmal, wenn die Nachricht so raus soll.</Text>
      ) : null}
      {screen.busy ? <ActivityIndicator style={styles.spinner} /> : null}
      <Button label={forgotten && warned ? 'Trotzdem senden' : 'Senden'} disabled={screen.busy || !hasRecipient(draft)} onPress={press} />
    </ScrollView>
  )
}

function Button(props: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      style={[styles.button, props.disabled && styles.buttonDisabled]}
      disabled={props.disabled}
      onPress={props.onPress}
    >
      <Text style={styles.buttonText}>{props.label}</Text>
    </Pressable>
  )
}

function Chip(props: { label: string; active: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      style={[styles.chip, props.active && styles.chipActive, props.disabled && styles.buttonDisabled]}
      disabled={props.disabled}
      onPress={props.onPress}
    >
      <Text style={props.active ? styles.chipTextActive : styles.chipText}>{props.label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#fff', padding: 16 },
  fill: { flex: 1 },
  centered: { flex: 1 },
  form: { gap: 12 },
  row: { flexDirection: 'row', gap: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 8 },
  title: { fontSize: 22, fontWeight: '600', marginVertical: 8, color: '#111' },
  hint: { color: '#555', marginBottom: 8 },
  error: { color: '#b00020', marginVertical: 8 },
  status: { backgroundColor: '#f3f0ff', borderRadius: 8, padding: 8, marginBottom: 8 },
  statusText: { color: '#3b2a8c' },
  statusProblem: { color: '#b00020', marginTop: 2 },
  pending: { fontSize: 13, color: '#3b2a8c', marginTop: 2 },
  input: { borderWidth: 1, borderColor: '#bbb', borderRadius: 8, padding: 12, fontSize: 16, color: '#111' },
  multiline: { minHeight: 200 },
  button: { backgroundColor: '#3b2a8c', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 8 },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontSize: 16 },
  chip: { borderWidth: 1, borderColor: '#3b2a8c', borderRadius: 16, paddingVertical: 6, paddingHorizontal: 14 },
  chipActive: { backgroundColor: '#3b2a8c' },
  chipText: { color: '#3b2a8c' },
  chipTextActive: { color: '#fff' },
  item: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ccc' },
  itemTitle: { fontSize: 16, color: '#111' },
  unread: { fontWeight: '700' },
  itemMeta: { fontSize: 13, color: '#666', marginTop: 2 },
  link: { color: '#3b2a8c', fontSize: 16, paddingVertical: 4 },
  spinner: { marginVertical: 8 },
  body: { fontSize: 15, lineHeight: 22, color: '#111', paddingBottom: 24 },
  attachments: { marginTop: 8, marginBottom: 24 },
  attachment: { paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#ccc', gap: 4 }
})
