import { useMemo, useState } from 'react'
import { FlatList, Text, View } from 'react-native'
import type { UnifiedState } from '../app/screens'
import { filterMessages, NO_FILTER } from '../listFilter'
import type { Tag } from '../tags'
import type { UnifiedMessage } from '../unified'
import { Fab } from './controls'
import { EmptyListNote } from './EmptyListNote'
import { OlderFooter } from './OlderFooter'
import { roleLabel } from './folderLabel'
import { ListHead } from './ListHead'
import { MessageRow } from './MessageRow'
import { SelectionBar, SelectionHeader } from './SelectionBar'
import { backAtText } from './snoozeText'
import { SwipeableRow } from './SwipeableRow'
import { TopBar } from './TopBar'
import { useSelection, type SelectionActions } from './useSelection'
import { useStyles } from './useStyles'

/** The folders of one role of all accounts in one list, newest first, each message marked with its account. */
export function UnifiedScreen(props: {
  state: UnifiedState
  actions: SelectionActions
  onRefresh: () => void
  onSearch: () => void
  onSettings: () => void
  onCompose: () => void
  onCreateTag: (name: string, color: string) => Promise<Tag | undefined>
  onOpen: (message: UnifiedMessage) => void
  /** Shows older messages, loading them where the phone has no more. */
  onOlder: () => void
}) {
  const styles = useStyles()
  const { role, messages, busy, problems, more, loadingMore } = props.state
  const [filter, setFilter] = useState(NO_FILTER)
  const shown = useMemo(() => filterMessages(messages, filter), [messages, filter])
  const selection = useSelection(shown, props.actions)

  return (
    <View style={styles.fill}>
      {selection.selecting ? (
        <SelectionHeader selection={selection} total={shown.length} />
      ) : (
        <>
          <TopBar onSearch={props.onSearch} onRefresh={props.onRefresh} onSettings={props.onSettings} />
          <ListHead
            title={roleLabel(role)}
            subtitle="Alle Konten"
            total={messages.length}
            shown={shown.length}
            filter={filter}
            onFilter={setFilter}
          />
        </>
      )}
      {problems.map((problem) => (
        <Text key={problem.accountId} style={styles.error}>
          {problem.accountName}: {problem.error}
        </Text>
      ))}
      {selection.notice ? <Text style={styles.error}>{selection.notice}</Text> : null}
      <FlatList
        data={shown}
        extraData={selection.picked}
        contentContainerStyle={styles.listBottom}
        keyExtractor={(message) => `${message.folderId}:${message.uid}`}
        refreshing={busy}
        onRefresh={props.onRefresh}
        onEndReached={() => (filter === NO_FILTER && more && !busy && !loadingMore ? props.onOlder() : undefined)}
        onEndReachedThreshold={0.6}
        ListEmptyComponent={<EmptyListNote busy={busy} total={messages.length} />}
        ListFooterComponent={<OlderFooter more={more} loading={loadingMore === true} onLoad={props.onOlder} />}
        renderItem={({ item }) => (
          <SwipeableRow
            disabled={selection.selecting}
            onArchive={() => selection.archiveMessage(item)}
            onDelete={() => selection.removeMessage(item)}
          >
            <MessageRow
              message={item}
              sender={item.sender}
              showPreview={props.state.showPreview}
              account={item.accountName}
              accountColor={item.accountColor}
              pendingNote={
              item.pendingMoveTo
                ? 'wird verschoben, sobald es geht'
                : role === 'snoozed' && item.snoozedUntil !== null
                  ? backAtText(item.snoozedUntil)
                  : undefined
            }
              choosing={selection.selecting}
              chosen={selection.isChosen(item)}
              onPress={() => (selection.selecting ? selection.toggle(item) : props.onOpen(item))}
              onLongPress={() => selection.toggle(item)}
            />
          </SwipeableRow>
        )}
      />
      {selection.selecting ? <SelectionBar selection={selection} snoozedList={role === 'snoozed'} flagLists={selection.picked.map((message) => message.flags)} onCreateTag={props.onCreateTag} /> : <Fab label="Neue Nachricht" onPress={props.onCompose} />}
    </View>
  )
}
