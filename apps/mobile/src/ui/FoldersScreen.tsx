import { useMemo, useState } from 'react'
import { FlatList, Pressable, Text, View } from 'react-native'
import type { FoldersState } from '../app/screens'
import { buildFolderTree, visibleRows } from '../folderTree'
import type { Folder } from '../folders'
import { ActionSheet } from './ActionSheet'
import { Button, Fab, IconButton } from './controls'
import { ConfirmDialog } from './ConfirmDialog'
import { folderIconName } from './folderIcon'
import { folderLabel } from './folderLabel'
import { Icon } from './Icon'
import { ListRow } from './ListRow'
import { TopBar } from './TopBar'
import { useStyles } from './useStyles'
import { useTheme } from './useTheme'
import { t } from '../i18n'

export function FoldersScreen(props: {
  state: FoldersState
  onOpen: (folder: Folder) => void
  onSearch: () => void
  onSettings: () => void
  onRemove: () => void
  onEdit: () => void
  onNewFolder: () => void
  /** What can be done to one folder: a long press on it. */
  onFolderTools: (folder: Folder) => void
  onSenders: () => void
  onConnect: () => void
  onCompose: () => void
}) {
  const styles = useStyles()
  const { colors } = useTheme()
  const { account, folders, unread, offline } = props.state
  // The paths of the folders that are closed. Folders start open, so that nothing is hidden that has not been closed.
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [menu, setMenu] = useState(false)
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
        <Text accessibilityRole="header" style={[styles.listTitle, { flex: 1 }]} numberOfLines={1}>
          {account.displayName}
        </Text>
        <IconButton name="more" label={t('Konto')} onPress={() => setMenu(true)} />
      </View>
      {offline ? (
        <View>
          <Text style={styles.error}>{offline}</Text>
          <Button label={t('Erneut verbinden')} onPress={props.onConnect} />
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
              onLongPress={node.folder ? () => props.onFolderTools(node.folder as Folder) : undefined}
            />
          )
        }}
      />
      <Fab label={t('Neue Nachricht')} onPress={props.onCompose} />
      <ActionSheet
        visible={menu}
        actions={[
          { label: t('Ordner anlegen'), onPress: props.onNewFolder },
          { label: t('Absender und Signatur'), onPress: props.onSenders },
          { label: t('Konto bearbeiten'), onPress: props.onEdit },
          { label: t('Konto entfernen'), danger: true, onPress: () => setConfirmingRemove(true) }
        ]}
        onClose={() => setMenu(false)}
      />
      <ConfirmDialog
        visible={confirmingRemove}
        title={t('{displayName} entfernen?', { displayName: account.displayName })}
        text={t('Das Konto, seine gespeicherten Nachrichten und alles, was noch auf eine Verbindung wartet, werden von diesem Gerät gelöscht. Auf dem Mailserver bleibt alles, wie es ist.')}
        answers={[
          { label: t('Abbrechen'), onPress: () => setConfirmingRemove(false) },
          {
            label: t('Konto entfernen'),
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
