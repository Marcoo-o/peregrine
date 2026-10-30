import { useMemo, useState } from 'react'
import { FlatList, Pressable, Text, View } from 'react-native'
import type { FoldersState } from '../app/screens'
import { buildFolderTree, visibleRows } from '../folderTree'
import type { Folder } from '../folders'
import { Button, Fab } from './controls'
import { ConfirmDialog } from './ConfirmDialog'
import { folderIconName } from './folderIcon'
import { folderLabel } from './folderLabel'
import { Icon } from './Icon'
import { ListRow } from './ListRow'
import { TopBar } from './TopBar'
import { useStyles } from './useStyles'
import { useTheme } from './useTheme'

export function FoldersScreen(props: {
  state: FoldersState
  onOpen: (folder: Folder) => void
  onSearch: () => void
  onSettings: () => void
  onRemove: () => void
  onEdit: () => void
  onConnect: () => void
  onCompose: () => void
}) {
  const styles = useStyles()
  const { colors } = useTheme()
  const { account, folders, unread, offline } = props.state
  // The paths of the folders that are closed. Folders start open, so that nothing is hidden that has not been closed.
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const rows = useMemo(() => visibleRows(buildFolderTree(folders), closed, unread), [folders, closed, unread])
  const nested = rows.some((row) => row.expanded !== null)

  const toggle = (path: string) =>
    setClosed((current) => {
      const next = new Set(current)
      if (!next.delete(path)) next.add(path)
      return next
    })

  return (
    <View style={styles.fill}>
      <TopBar onSearch={props.onSearch} onSettings={props.onSettings} />
      <View style={styles.accountTitleRow}>
        <View style={[styles.accountSquare, { backgroundColor: account.color }]} />
        <Text accessibilityRole="header" style={styles.listTitle} numberOfLines={1}>
          {account.displayName}
        </Text>
      </View>
      {offline ? (
        <View>
          <Text style={styles.error}>{offline}</Text>
          <Button label="Erneut verbinden" onPress={props.onConnect} />
        </View>
      ) : null}
      <FlatList
        data={rows}
        contentContainerStyle={styles.listBottom}
        keyExtractor={(row) => row.node.path}
        renderItem={({ item }) => {
          const { node } = item
          return (
            <ListRow
              title={node.folder ? folderLabel(node.folder) : node.label}
              icon={node.folder ? folderIconName(node.folder) : 'folder'}
              count={item.count}
              depth={item.depth}
              // Room for the button is made for every row when any has one, so that the names line up.
              expanded={nested ? item.expanded : undefined}
              onToggle={() => toggle(node.path)}
              // A name that only holds others has nothing to open: it opens and closes.
              onPress={() => (node.folder ? props.onOpen(node.folder) : toggle(node.path))}
            />
          )
        }}
        // What cannot be taken back is at the end of the list, away from what is opened and written every day.
        ListFooterComponent={
          <>
            <Pressable accessibilityRole="button" style={styles.removeRow} onPress={props.onEdit}>
              <Icon name="settings" size={18} color={colors.accent} />
              <Text style={styles.editText}>Konto bearbeiten</Text>
            </Pressable>
          <Pressable accessibilityRole="button" style={styles.removeRow} onPress={() => setConfirmingRemove(true)}>
            <Icon name="trash" size={18} color={colors.danger} />
            <Text style={styles.removeText}>Konto entfernen</Text>
          </Pressable>
          </>
        }
      />
      <Fab label="Neue Nachricht" onPress={props.onCompose} />
      <ConfirmDialog
        visible={confirmingRemove}
        title={`${account.displayName} entfernen?`}
        text="Das Konto, seine gespeicherten Nachrichten und alles, was noch auf eine Verbindung wartet, werden von diesem Gerät gelöscht. Auf dem Mailserver bleibt alles, wie es ist."
        answers={[
          { label: 'Abbrechen', onPress: () => setConfirmingRemove(false) },
          {
            label: 'Konto entfernen',
            variant: 'danger',
            onPress: () => {
              setConfirmingRemove(false)
              props.onRemove()
            }
          }
        ]}
      />
    </View>
  )
}
