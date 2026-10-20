import { FlatList, Text, View } from 'react-native'
import type { UnifiedState } from '../app/screens'
import type { UnifiedMessage } from '../unified'
import { BackLink } from './controls'
import { MessageRow } from './MessageRow'
import { styles } from './styles'

/** The inboxes of all accounts in one list, newest first, each message marked with its account. */
export function UnifiedScreen(props: {
  state: UnifiedState
  onAccounts: () => void
  onRefresh: () => void
  onOpen: (message: UnifiedMessage) => void
}) {
  const { messages, busy, problems } = props.state
  return (
    <View style={styles.fill}>
      <BackLink label="‹ Konten" onPress={props.onAccounts} />
      <Text style={styles.title}>Alle Posteingänge</Text>
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
            byline={`${item.accountName}  ·  ${item.sender}`}
            pendingNote={item.pendingMoveTo ? 'wird verschoben, sobald es geht' : undefined}
            onPress={() => props.onOpen(item)}
          />
        )}
      />
    </View>
  )
}
