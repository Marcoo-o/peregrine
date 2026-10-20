import { FlatList, Text, View } from 'react-native'
import type { FoldersState } from '../app/screens'
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
        data={folders}
        keyExtractor={(folder) => folder.id}
        renderItem={({ item }) => (
          <ListRow title={folderLabel(item)} count={unread[item.id]} onPress={() => props.onOpen(item)} />
        )}
      />
      <Button label="Neue Nachricht" onPress={props.onCompose} />
      <Button label="Konto entfernen" variant="danger" onPress={props.onRemove} />
    </View>
  )
}
