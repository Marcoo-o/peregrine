import { FlatList, View } from 'react-native'
import type { MoveState } from '../app/screens'
import type { Folder } from '../folders'
import { folderIconName } from './folderIcon'
import { folderLabel } from './folderLabel'
import { Header } from './Header'
import { ListRow } from './ListRow'
import { useStyles } from './useStyles'
import { t } from '../i18n'

/** The choice of the folder a message is moved to. */
export function MoveScreen(props: { state: MoveState; onChoose: (target: Folder) => void; onBack: () => void }) {
  const styles = useStyles()
  return (
    <View style={styles.fill}>
      <Header title={t('Verschieben nach')} back={{ label: t('Zurück'), onPress: props.onBack }} />
      <FlatList
        data={props.state.targets}
        keyExtractor={(folder) => folder.id}
        renderItem={({ item }) => <ListRow title={folderLabel(item)} icon={folderIconName(item)} onPress={() => props.onChoose(item)} />}
      />
    </View>
  )
}
