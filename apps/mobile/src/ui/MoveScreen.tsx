import { FlatList, Pressable, Text, View } from 'react-native'
import type { MoveState } from '../app/screens'
import type { Folder } from '../folders'
import { BackLink } from './controls'
import { styles } from './styles'

/** The choice of the folder a message is moved to. */
export function MoveScreen(props: { state: MoveState; onChoose: (target: Folder) => void; onBack: () => void }) {
  return (
    <View style={styles.fill}>
      <BackLink label="‹ Zurück" onPress={props.onBack} />
      <Text style={styles.title}>Verschieben nach</Text>
      <FlatList
        data={props.state.targets}
        keyExtractor={(folder) => folder.id}
        renderItem={({ item }) => (
          <Pressable style={styles.item} onPress={() => props.onChoose(item)}>
            <Text style={styles.itemTitle}>{item.displayName}</Text>
          </Pressable>
        )}
      />
    </View>
  )
}
