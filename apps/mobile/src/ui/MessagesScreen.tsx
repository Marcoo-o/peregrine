import { useMemo, useState } from 'react'
import { FlatList, Text, View } from 'react-native'
import type { MessagesState } from '../app/screens'
import { filterMessages, NO_FILTER } from '../listFilter'
import type { StoredMessage } from '../messages'
import type { Tag } from '../tags'
import { Fab, Spinner } from './controls'
import { EmptyListNote } from './EmptyListNote'
import { folderLabel } from './folderLabel'
import { ListHead } from './ListHead'
import { MessageRow } from './MessageRow'
import { SelectionBar, SelectionHeader } from './SelectionBar'
import { SwipeableRow } from './SwipeableRow'
import { TopBar } from './TopBar'
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
  onRefresh: () => void
  onSearch: () => void
  onSettings: () => void
  onCompose: () => void
  onCreateTag: (name: string, color: string) => Promise<Tag | undefined>
  onOpen: (message: StoredMessage) => void
}) {
  const styles = useStyles()
  const { account, folder, messages, showPreview, folderNames, busy, error } = props.state
  const [filter, setFilter] = useState(NO_FILTER)
  // What the choice needs of a message: where it is, which the list of one folder does not say of each of them.
  const rows = useMemo(
    () =>
      filterMessages(messages, filter).map((message) => ({ message, accountId: account.id, folderId: folder.id, uid: message.uid })),
    [messages, filter, account.id, folder.id]
  )
  const selection = useSelection(rows, props.actions)

  return (
    <View style={styles.fill}>
      {selection.selecting ? (
        <SelectionHeader selection={selection} total={rows.length} />
      ) : (
        <>
          <TopBar onSearch={props.onSearch} onRefresh={props.onRefresh} onSettings={props.onSettings} />
          <ListHead
            title={folderLabel(folder)}
            subtitle={account.displayName}
            total={messages.length}
            shown={rows.length}
            filter={filter}
            onFilter={setFilter}
          />
        </>
      )}
      {busy ? <Spinner /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {selection.notice ? <Text style={styles.error}>{selection.notice}</Text> : null}
      <FlatList
        data={rows}
        extraData={selection.picked}
        contentContainerStyle={styles.listBottom}
        keyExtractor={(row) => String(row.uid)}
        refreshing={busy}
        onRefresh={props.onRefresh}
        ListEmptyComponent={<EmptyListNote busy={busy} total={messages.length} />}
        renderItem={({ item }) => (
          <SwipeableRow
            disabled={selection.selecting}
            onArchive={() => selection.archiveMessage(item)}
            onDelete={() => selection.removeMessage(item)}
          >
            <MessageRow
              message={item.message}
              sender={item.message.sender}
              showPreview={showPreview}
              pendingNote={pendingNote(item.message, folderNames)}
              choosing={selection.selecting}
              chosen={selection.isChosen(item)}
              onPress={() => (selection.selecting ? selection.toggle(item) : props.onOpen(item.message))}
              onLongPress={() => selection.toggle(item)}
            />
          </SwipeableRow>
        )}
      />
      {selection.selecting ? <SelectionBar selection={selection} flagLists={selection.picked.map((row) => row.message.flags)} onCreateTag={props.onCreateTag} /> : <Fab label="Neue Nachricht" onPress={props.onCompose} />}
    </View>
  )
}
