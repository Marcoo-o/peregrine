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
import type { ImapSession } from '@peregrine/core/imapSession'
import type { QueueRunner } from '@peregrine/core/offlineQueue'
import type { SecureMode } from '@peregrine/core/types'
import type { SqlDb } from '@peregrine/core/sqlDb'
import { ImapClientSession } from '@peregrine/imap/session'
import { addAccount, listAccounts, removeAccount, type Account } from './src/accounts'
import { openDatabase } from './src/database'
import { listFolders, syncFolders, type Folder } from './src/folders'
import { listMessages, type StoredMessage } from './src/messages'
import { readMessage, type ReadableMessage } from './src/messageText'
import { createTransport } from './src/native'
import { createQueue } from './src/queue'
import { syncFolder } from './src/sync'

/**
 * The prototype of stages 4 and 5: any number of accounts, the folders of one, the messages of a
 * folder, one message opened. It writes nothing on the server except what the offline queue replays,
 * and nothing in these screens puts anything into the queue yet. The screens are as plain as they can
 * be and are meant to be thrown away. What is being tried is everything underneath them.
 */

type Screen =
  | { name: 'loading' }
  | { name: 'accounts'; accounts: Account[]; error?: string }
  | { name: 'login'; error?: string }
  | { name: 'folders'; account: Account; folders: Folder[] }
  | { name: 'messages'; account: Account; folder: Folder; messages: StoredMessage[]; busy: boolean; error?: string }
  | { name: 'message'; account: Account; folder: Folder; summary: StoredMessage; message?: ReadableMessage; error?: string }

/** What the form asks for: the way into one mailbox. */
interface Credentials {
  host: string
  port: number
  secure: SecureMode
  username: string
  password: string
}

const credentialsOf = (account: Account): Credentials => ({
  host: account.imapHost,
  port: account.imapPort,
  secure: account.imapSecure,
  username: account.imapUsername,
  password: account.password
})

/** Connects, or throws with the reason. */
async function connectWith(credentials: Credentials): Promise<ImapSession> {
  const session = new ImapClientSession(credentials, { transport: createTransport() })
  await session.connect()
  return session
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'loading' })
  const database = useRef<SqlDb | null>(null)
  const queue = useRef<QueueRunner | null>(null)
  const session = useRef<ImapSession | null>(null)
  // What was typed last, so a failed sign-in does not make anybody type it all again.
  const attempt = useRef<Credentials | undefined>(undefined)

  const drop = () => {
    session.current?.disconnect().catch(() => undefined)
    session.current = null
  }

  /** The list of accounts, or the form when there is none. */
  const showAccounts = useCallback(async (error?: string) => {
    const db = database.current
    if (!db) return
    const accounts = await listAccounts(db)
    setScreen(accounts.length === 0 ? { name: 'login', error } : { name: 'accounts', accounts, error })
  }, [])

  /** With a connection that works: replays what waited for one, takes the folders from the server. */
  const showFolders = useCallback(async (account: Account, connected: ImapSession) => {
    const db = database.current
    if (!db) return
    session.current = connected
    // A failed replay is kept in the queue with its reason and does not stop the mailbox from opening.
    await queue.current
      ?.flush(account.id, connected)
      .catch((error) => console.error('replaying the queue failed:', describe(error)))
    await syncFolders(db, account.id, await connected.listMailboxes())
    setScreen({ name: 'folders', account, folders: await listFolders(db, account.id) })
  }, [])

  const openAccount = useCallback(
    async (account: Account) => {
      setScreen({ name: 'loading' })
      try {
        drop()
        await showFolders(account, await connectWith(credentialsOf(account)))
      } catch (error) {
        drop()
        await showAccounts(`${account.displayName}: ${describe(error)}`)
      }
    },
    [showAccounts, showFolders]
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const db = await openDatabase()
        database.current = db
        queue.current = createQueue(db, {
          changed: async () => undefined,
          log: { warn: (message) => console.warn(message), error: (message) => console.error(message) }
        })
        const accounts = await listAccounts(db)
        if (cancelled) return
        if (accounts.length === 1) await openAccount(accounts[0])
        else await showAccounts()
      } catch (error) {
        if (!cancelled) setScreen({ name: 'login', error: describe(error) })
      }
    })()
    return () => {
      cancelled = true
      queue.current?.stop()
      drop()
    }
  }, [openAccount, showAccounts])

  const openFolder = async (account: Account, folder: Folder) => {
    const db = database.current
    const imap = session.current
    if (!db || !imap) return
    setScreen({ name: 'messages', account, folder, messages: await listMessages(db, folder.id), busy: true })
    try {
      await syncFolder(imap, db, folder)
      setScreen({ name: 'messages', account, folder, messages: await listMessages(db, folder.id), busy: false })
    } catch (error) {
      setScreen({
        name: 'messages',
        account,
        folder,
        messages: await listMessages(db, folder.id),
        busy: false,
        error: describe(error)
      })
    }
  }

  const openMessage = async (account: Account, folder: Folder, summary: StoredMessage) => {
    setScreen({ name: 'message', account, folder, summary })
    try {
      const full = await session.current?.fetchFullMessage(folder.imapPath, summary.uid)
      if (!full) throw new Error('Die Nachricht gibt es auf dem Server nicht mehr')
      setScreen({ name: 'message', account, folder, summary, message: readMessage(full.source) })
    } catch (error) {
      setScreen({ name: 'message', account, folder, summary, error: describe(error) })
    }
  }

  const removeCurrent = async (account: Account) => {
    drop()
    if (database.current) await removeAccount(database.current, account.id)
    await showAccounts()
  }

  /** A new account is kept only once it has connected. A mistyped server would otherwise be tried at every start. */
  const signIn = async (credentials: Credentials) => {
    const db = database.current
    if (!db) return
    attempt.current = credentials
    setScreen({ name: 'loading' })
    try {
      drop()
      const connected = await connectWith(credentials)
      const account = await addAccount(db, {
        displayName: credentials.username,
        emailAddress: credentials.username.includes('@') ? credentials.username : '',
        imapHost: credentials.host,
        imapPort: credentials.port,
        imapSecure: credentials.secure,
        imapUsername: credentials.username,
        smtpHost: null,
        smtpPort: null,
        smtpSecure: null,
        smtpUsername: null,
        password: credentials.password,
        smtpPassword: null
      })
      await showFolders(account, connected)
    } catch (error) {
      drop()
      setScreen({ name: 'login', error: describe(error) })
    }
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={styles.page}>
        {screen.name === 'loading' && <ActivityIndicator style={styles.centered} size="large" />}
        {screen.name === 'accounts' && (
          <Accounts
            accounts={screen.accounts}
            error={screen.error}
            onOpen={openAccount}
            onAdd={() => setScreen({ name: 'login' })}
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
            onOpen={(folder) => openFolder(screen.account, folder)}
            onBack={() => {
              drop()
              void showAccounts()
            }}
            onRemove={() => removeCurrent(screen.account)}
          />
        )}
        {screen.name === 'messages' && (
          <Messages
            screen={screen}
            onBack={async () => {
              const db = database.current
              if (db) setScreen({ name: 'folders', account: screen.account, folders: await listFolders(db, screen.account.id) })
            }}
            onOpen={(summary) => openMessage(screen.account, screen.folder, summary)}
          />
        )}
        {screen.name === 'message' && (
          <MessageView screen={screen} onBack={() => openFolder(screen.account, screen.folder)} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

function Accounts(props: {
  accounts: Account[]
  error?: string
  onOpen: (account: Account) => void
  onAdd: () => void
}) {
  return (
    <View style={styles.fill}>
      <Text style={styles.title}>Konten</Text>
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
  initial?: Credentials
  onSubmit: (credentials: Credentials) => void
  onCancel: () => void
}) {
  const { initial } = props
  const [host, setHost] = useState(initial?.host ?? '')
  const [port, setPort] = useState(String(initial?.port ?? 993))
  const [secure, setSecure] = useState<SecureMode>(initial?.secure ?? 'tls')
  const [username, setUsername] = useState(initial?.username ?? '')
  const [password, setPassword] = useState(initial?.password ?? '')

  const choose = (mode: SecureMode) => {
    setSecure(mode)
    setPort(mode === 'tls' ? '993' : '143')
  }
  const ready = host.trim() !== '' && username !== '' && password !== '' && Number(port) > 0

  return (
    <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Peregrine</Text>
      <Text style={styles.hint}>Ein Konto per IMAP verbinden. Das Passwort bleibt verschlüsselt auf diesem Gerät.</Text>
      {props.error ? <Text style={styles.error}>{props.error}</Text> : null}
      <TextInput style={styles.input} placeholder="IMAP-Server (mail.example.org)" autoCapitalize="none" autoCorrect={false} value={host} onChangeText={setHost} />
      <View style={styles.row}>
        <Chip label="TLS" active={secure === 'tls'} onPress={() => choose('tls')} />
        <Chip label="STARTTLS" active={secure === 'starttls'} onPress={() => choose('starttls')} />
      </View>
      <TextInput style={styles.input} placeholder="Port" keyboardType="number-pad" value={port} onChangeText={setPort} />
      <TextInput style={styles.input} placeholder="Benutzername" autoCapitalize="none" autoCorrect={false} value={username} onChangeText={setUsername} />
      <TextInput style={styles.input} placeholder="Passwort" secureTextEntry autoCapitalize="none" value={password} onChangeText={setPassword} />
      <Button
        label="Verbinden"
        disabled={!ready}
        onPress={() => props.onSubmit({ host: host.trim(), port: Number(port), secure, username, password })}
      />
      <Pressable onPress={props.onCancel}>
        <Text style={styles.link}>‹ Zurück zu den Konten</Text>
      </Pressable>
    </ScrollView>
  )
}

function Folders(props: {
  account: Account
  folders: Folder[]
  onOpen: (folder: Folder) => void
  onBack: () => void
  onRemove: () => void
}) {
  return (
    <View style={styles.fill}>
      <Pressable onPress={props.onBack}>
        <Text style={styles.link}>‹ Konten</Text>
      </Pressable>
      <Text style={styles.title}>{props.account.displayName}</Text>
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
            <Text style={[styles.itemTitle, !item.flags.includes('\\Seen') && styles.unread]} numberOfLines={1}>
              {item.subject || '(ohne Betreff)'}
            </Text>
            <Text style={styles.itemMeta} numberOfLines={1}>
              {item.sender}
              {item.dateMs ? `  ·  ${new Date(item.dateMs).toLocaleDateString('de-DE')}` : ''}
            </Text>
          </Pressable>
        )}
      />
    </View>
  )
}

function MessageView(props: { screen: Extract<Screen, { name: 'message' }>; onBack: () => void }) {
  const { screen } = props
  return (
    <View style={styles.fill}>
      <Pressable onPress={props.onBack}>
        <Text style={styles.link}>‹ Zurück</Text>
      </Pressable>
      <Text style={styles.title}>{screen.message?.subject || screen.summary.subject || '(ohne Betreff)'}</Text>
      <Text style={styles.itemMeta}>{screen.message?.from || screen.summary.sender}</Text>
      {screen.error ? <Text style={styles.error}>{screen.error}</Text> : null}
      {!screen.message && !screen.error ? <ActivityIndicator style={styles.spinner} /> : null}
      <ScrollView style={styles.fill}>
        <Text selectable style={styles.body}>
          {screen.message?.text ?? ''}
        </Text>
      </ScrollView>
    </View>
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

function Chip(props: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.chip, props.active && styles.chipActive]} onPress={props.onPress}>
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
  title: { fontSize: 22, fontWeight: '600', marginVertical: 8, color: '#111' },
  hint: { color: '#555', marginBottom: 8 },
  error: { color: '#b00020', marginVertical: 8 },
  input: { borderWidth: 1, borderColor: '#bbb', borderRadius: 8, padding: 12, fontSize: 16, color: '#111' },
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
  body: { fontSize: 15, lineHeight: 22, color: '#111', paddingBottom: 24 }
})
