import { useMemo, useState } from 'react'
import { FlatList, Text, View } from 'react-native'
import type { FoldersState } from '../app/screens'
import { buildFolderTree, visibleRows } from '../folderTree'
import type { Folder } from '../folders'
import { Button } from './controls'
import { folderLabel } from './folderLabel'
import { Header } from './Header'
import { ListRow } from './ListRow'
import { useStyles } from './useStyles'

export function FoldersScreen(props: {
  state: FoldersState
  onOpen: (folder: Folder) => void
  onBack: () => void
  onRemove: () => void
  onConnect: () => void
  onCompose: () => void
}) {
  const styles = useStyles()
  const { account, folders, unread, offline } = props.state
  // The paths of the folders that are closed. Folders start open, so that nothing is hidden that has not been closed.
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
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
      <Header title={account.displayName} back={{ label: 'Konten', onPress: props.onBack }} />
      {offline ? (
        <View>
          <Text style={styles.error}>{offline}</Text>
          <Button label="Erneut verbinden" onPress={props.onConnect} />
        </View>
      ) : null}
      <FlatList
        data={rows}
        keyExtractor={(row) => row.node.path}
        renderItem={({ item }) => {
          const { node } = item
          return (
            <ListRow
              title={node.folder ? folderLabel(node.folder) : node.label}
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
      />
      <Button label="Neue Nachricht" onPress={props.onCompose} />
      <Button label="Konto entfernen" variant="danger" onPress={props.onRemove} />
    </View>
  )
}
