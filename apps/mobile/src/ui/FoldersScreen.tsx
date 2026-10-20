import { FlatList, Pressable, Text, View } from 'react-native'
import type { FoldersState } from '../app/screens'
import type { Folder } from '../folders'
import { BackLink, Button } from './controls'
import { styles } from './styles'

export function FoldersScreen(props: {
  state: FoldersState
  onOpen: (folder: Folder) => void
  onBack: () => void
  onRemove: () => void
  onConnect: () => void
  onCompose: () => void
}) {
  const { account, folders, offline } = props.state
  return (
    <View style={styles.fill}>
      <BackLink label="‹ Konten" onPress={props.onBack} />
      <Text style={styles.title}>{account.displayName}</Text>
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
          <Pressable style={styles.item} onPress={() => props.onOpen(item)}>
            <Text style={styles.itemTitle}>{item.imapPath}</Text>
            {item.specialUse ? <Text style={styles.itemMeta}>{item.specialUse}</Text> : null}
          </Pressable>
        )}
      />
      <Button label="Neue Nachricht" onPress={props.onCompose} />
      <Button label="Konto entfernen" onPress={props.onRemove} />
    </View>
  )
}
