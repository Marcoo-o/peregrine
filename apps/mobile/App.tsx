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
import type { ImapSession, MailboxEntry } from '@peregrine/core/imapSession'
import type { SecureMode } from '@peregrine/core/types'
import type { SqlDb } from '@peregrine/core/sqlDb'
import { ImapClientSession } from '@peregrine/imap/session'
import { openDatabase } from './src/database'
import { createTransport } from './src/native'
import { readMessage, type ReadableMessage } from './src/messageText'
import {
  forgetAccount,
  listMessages,
  loadAccount,
  saveAccount,
  type Account,
  type StoredMessage
} from './src/store'
import { syncFolder } from './src/sync'

/**
 * The prototype of stage 4: sign in to one account, list its folders, list the messages of one,
 * open one. It reads and writes nothing on the server. The screens are as plain as they can be and
 * are meant to be thrown away. What is being tried is everything underneath them.
 */

type Screen =
  | { name: 'loading' }
  | { name: 'login'; error?: string }
  | { name: 'folders'; folders: MailboxEntry[] }
  | { name: 'messages'; folder: string; messages: StoredMessage[]; busy: boolean; error?: string }
  | { name: 'message'; folder: string; summary: StoredMessage; message?: ReadableMessage; error?: string }

function connect(account: Account): ImapSession {
  return new ImapClientSession(
    {
      host: account.host,
      port: account.port,
      secure: account.secure,
      username: account.username,
      password: account.password
    },
    { transport: createTransport() }
  )
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'loading' })
  const database = useRef<SqlDb | null>(null)
  const session = useRef<ImapSession | null>(null)
  // What was typed last, so a failed sign-in does not make anybody type it all again.
  const attempt = useRef<Account | undefined>(undefined)

  /** Connects and shows the folders. False when it did not work, with the reason on the login screen. */
  const showFolders = useCallback(async (account: Account): Promise<boolean> => {
    setScreen({ name: 'loading' })
    try {
      session.current?.disconnect().catch(() => undefined)
      const next = connect(account)
      await next.connect()
      session.current = next
      setScreen({ name: 'folders', folders: await next.listMailboxes() })
      return true
    } catch (error) {
      session.current = null
      setScreen({ name: 'login', error: describe(error) })
      return false
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const db = await openDatabase()
        database.current = db
        const account = await loadAccount(db)
        if (cancelled) return
        if (account) {
          // so that the form is filled in when connecting fails, offline for instance
          attempt.current = account
          await showFolders(account)
        } else setScreen({ name: 'login' })
      } catch (error) {
        if (!cancelled) setScreen({ name: 'login', error: describe(error) })
      }
    })()
    return () => {
      cancelled = true
      session.current?.disconnect().catch(() => undefined)
    }
  }, [showFolders])

  const openFolder = async (folder: string) => {
    const db = database.current
    const imap = session.current
    if (!db || !imap) return
    setScreen({ name: 'messages', folder, messages: await listMessages(db, folder), busy: true })
    try {
      await syncFolder(imap, db, folder)
      setScreen({ name: 'messages', folder, messages: await listMessages(db, folder), busy: false })
    } catch (error) {
      setScreen({
        name: 'messages',
        folder,
        messages: await listMessages(db, folder),
        busy: false,
        error: describe(error)
      })
    }
  }

  const openMessage = async (folder: string, summary: StoredMessage) => {
    setScreen({ name: 'message', folder, summary })
    try {
      const full = await session.current?.fetchFullMessage(folder, summary.uid)
      if (!full) throw new Error('Die Nachricht gibt es auf dem Server nicht mehr')
      setScreen({ name: 'message', folder, summary, message: readMessage(full.source) })
    } catch (error) {
      setScreen({ name: 'message', folder, summary, error: describe(error) })
    }
  }

  const signOut = async () => {
    session.current?.disconnect().catch(() => undefined)
    session.current = null
    if (database.current) await forgetAccount(database.current)
    setScreen({ name: 'login' })
  }

  const signIn = async (account: Account) => {
    if (!database.current) return
    attempt.current = account
    // Kept only once it has worked. A mistyped server would otherwise be tried again at every start.
    if (await showFolders(account)) await saveAccount(database.current, account)
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={styles.page}>
        {screen.name === 'loading' && <ActivityIndicator style={styles.centered} size="large" />}
        {screen.name === 'login' && (
          <Login error={screen.error} initial={attempt.current} onSubmit={signIn} />
        )}
        {screen.name === 'folders' && (
          <Folders folders={screen.folders} onOpen={openFolder} onSignOut={signOut} />
        )}
        {screen.name === 'messages' && (
          <Messages
            screen={screen}
            onBack={async () => {
              const imap = session.current
              if (imap) setScreen({ name: 'folders', folders: await imap.listMailboxes() })
            }}
            onOpen={(summary) => openMessage(screen.folder, summary)}
          />
        )}
        {screen.name === 'message' && (
          <MessageView screen={screen} onBack={() => openFolder(screen.folder)} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

function Login(props: {
  error?: string
  initial?: Account
  onSubmit: (account: Account) => void
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
    </ScrollView>
  )
}

function Folders(props: { folders: MailboxEntry[]; onOpen: (path: string) => void; onSignOut: () => void }) {
  return (
    <View style={styles.fill}>
      <Text style={styles.title}>Ordner</Text>
      <FlatList
        data={props.folders}
        keyExtractor={(folder) => folder.path}
        renderItem={({ item }) => (
          <Pressable style={styles.item} onPress={() => props.onOpen(item.path)}>
            <Text style={styles.itemTitle}>{item.path}</Text>
            {item.specialUse ? <Text style={styles.itemMeta}>{item.specialUse}</Text> : null}
          </Pressable>
        )}
      />
      <Button label="Abmelden und Konto vergessen" onPress={props.onSignOut} />
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
      <Text style={styles.title}>{screen.folder}</Text>
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
