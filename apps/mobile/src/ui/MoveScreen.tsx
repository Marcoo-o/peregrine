import { FlatList, View } from 'react-native'
import type { MoveState } from '../app/screens'
import type { Folder } from '../folders'
import { folderLabel } from './folderLabel'
import { Header } from './Header'
import { ListRow } from './ListRow'
import { useStyles } from './useStyles'

/** The choice of the folder a message is moved to. */
export function MoveScreen(props: { state: MoveState; onChoose: (target: Folder) => void; onBack: () => void }) {
  const styles = useStyles()
  return (
    <View style={styles.fill}>
      <Header title="Verschieben nach" back={{ label: 'Zurück', onPress: props.onBack }} />
      <FlatList
        data={props.state.targets}
        keyExtractor={(folder) => folder.id}
        renderItem={({ item }) => <ListRow title={folderLabel(item)} onPress={() => props.onChoose(item)} />}
      />
    </View>
  )
}
