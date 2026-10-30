import { FlatList, Text, View } from 'react-native'
import type { ThreadState } from '../app/screens'
import { Header } from './Header'
import { MessageRow } from './MessageRow'
import { useStyles } from './useStyles'

/** The messages of one conversation, the newest first: each opens as it does from the list, and what was read stays read. */
export function ThreadScreen(props: { state: ThreadState; onOpen: (item: ThreadState['items'][number]) => void; onBack: () => void }) {
  const styles = useStyles()
  const { subject, items } = props.state
  return (
    <View style={styles.fill}>
      <Header title={subject || '(ohne Betreff)'} back={{ label: 'Zurück', onPress: props.onBack }} />
      <Text style={styles.hint}>{items.length === 1 ? '1 Nachricht' : `${items.length} Nachrichten`}</Text>
      <FlatList
        data={items}
        contentContainerStyle={styles.listBottom}
        keyExtractor={(item) => `${item.folderId}:${item.message.uid}`}
        renderItem={({ item }) => (
          <MessageRow
            message={item.message}
            sender={item.message.sender}
            showPreview
            account={item.accountName}
            accountColor={item.accountColor}
            onPress={() => props.onOpen(item)}
          />
        )}
      />
    </View>
  )
}
