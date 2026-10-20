import { FlatList, Text, View } from 'react-native'
import type { UnifiedState } from '../app/screens'
import type { UnifiedMessage } from '../unified'
import { Header } from './Header'
import { MessageRow } from './MessageRow'
import { useStyles } from './useStyles'

/** The inboxes of all accounts in one list, newest first, each message marked with its account. */
export function UnifiedScreen(props: {
  state: UnifiedState
  onAccounts: () => void
  onRefresh: () => void
  onOpen: (message: UnifiedMessage) => void
}) {
  const styles = useStyles()
  const { messages, busy, problems } = props.state
  return (
    <View style={styles.fill}>
      <Header title="Alle Posteingänge" back={{ label: 'Konten', onPress: props.onAccounts }} />
      {problems.map((problem) => (
        <Text key={problem.accountId} style={styles.error}>
          {problem.accountName}: {problem.error}
        </Text>
      ))}
      <FlatList
        data={messages}
        keyExtractor={(message) => `${message.folderId}:${message.uid}`}
        refreshing={busy}
        onRefresh={props.onRefresh}
        ListEmptyComponent={busy ? undefined : <Text style={styles.hint}>Keine Nachrichten.</Text>}
        renderItem={({ item }) => (
          <MessageRow
            message={item}
            sender={item.sender}
            account={item.accountName}
            accountColor={item.accountColor}
            pendingNote={item.pendingMoveTo ? 'wird verschoben, sobald es geht' : undefined}
            onPress={() => props.onOpen(item)}
          />
        )}
      />
    </View>
  )
}
