import { FlatList, Text, View } from 'react-native'
import type { MessagesState } from '../app/screens'
import type { StoredMessage } from '../messages'
import { Spinner } from './controls'
import { folderLabel } from './folderLabel'
import { Header } from './Header'
import { MessageRow } from './MessageRow'
import { useStyles } from './useStyles'

/** What is said about a message whose move waits for a connection: where it is going. */
function pendingNote(message: StoredMessage, folderNames: Record<string, string>): string | undefined {
  if (!message.pendingMoveTo) return undefined
  return `→ ${folderNames[message.pendingMoveTo] ?? 'anderer Ordner'}, sobald es geht`
}

export function MessagesScreen(props: {
  state: MessagesState
  onBack: () => void
  onOpen: (message: StoredMessage) => void
}) {
  const styles = useStyles()
  const { folder, messages, folderNames, busy, error } = props.state
  return (
    <View style={styles.fill}>
      <Header title={folderLabel(folder)} back={{ label: 'Ordner', onPress: props.onBack }} />
      {busy ? <Spinner /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={messages}
        keyExtractor={(message) => String(message.uid)}
        ListEmptyComponent={busy ? undefined : <Text style={styles.hint}>Keine Nachrichten.</Text>}
        renderItem={({ item }) => (
          <MessageRow
            message={item}
            sender={item.sender}
            pendingNote={pendingNote(item, folderNames)}
            onPress={() => props.onOpen(item)}
          />
        )}
      />
    </View>
  )
}
