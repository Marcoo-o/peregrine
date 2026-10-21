import { useMemo } from 'react'
import { FlatList, Text, View } from 'react-native'
import type { MessagesState } from '../app/screens'
import type { StoredMessage } from '../messages'
import { Spinner } from './controls'
import { folderLabel } from './folderLabel'
import { Header } from './Header'
import { MessageRow } from './MessageRow'
import { SelectionBar, SelectionHeader } from './SelectionBar'
import { useSelection, type SelectionActions } from './useSelection'
import { useStyles } from './useStyles'

/** What is said about a message whose move waits for a connection: where it is going. */
function pendingNote(message: StoredMessage, folderNames: Record<string, string>): string | undefined {
  if (!message.pendingMoveTo) return undefined
  return `→ ${folderNames[message.pendingMoveTo] ?? 'anderer Ordner'}, sobald es geht`
}

export function MessagesScreen(props: {
  state: MessagesState
  actions: SelectionActions
  onBack: () => void
  onOpen: (message: StoredMessage) => void
}) {
  const styles = useStyles()
  const { account, folder, messages, folderNames, busy, error } = props.state
  // What the choice needs of a message: where it is, which the list of one folder does not say of each of them.
  const rows = useMemo(
    () => messages.map((message) => ({ message, accountId: account.id, folderId: folder.id, uid: message.uid })),
    [messages, account.id, folder.id]
  )
  const selection = useSelection(rows, props.actions)

  return (
    <View style={styles.fill}>
      {selection.selecting ? (
        <SelectionHeader selection={selection} total={rows.length} />
      ) : (
        <Header title={folderLabel(folder)} back={{ label: 'Ordner', onPress: props.onBack }} />
      )}
      {busy ? <Spinner /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {selection.notice ? <Text style={styles.error}>{selection.notice}</Text> : null}
      <FlatList
        data={rows}
        extraData={selection.picked}
        keyExtractor={(row) => String(row.uid)}
        ListEmptyComponent={busy ? undefined : <Text style={styles.hint}>Keine Nachrichten.</Text>}
        renderItem={({ item }) => (
          <MessageRow
            message={item.message}
            sender={item.message.sender}
            pendingNote={pendingNote(item.message, folderNames)}
            choosing={selection.selecting}
            chosen={selection.isChosen(item)}
            onPress={() => (selection.selecting ? selection.toggle(item) : props.onOpen(item.message))}
            onLongPress={() => selection.toggle(item)}
          />
        )}
      />
      {selection.selecting ? <SelectionBar selection={selection} /> : null}
    </View>
  )
}
