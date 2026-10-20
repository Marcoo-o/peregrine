import { ActivityIndicator } from 'react-native'
import { styles } from './styles'

export function LoadingScreen() {
  return <ActivityIndicator style={styles.centered} size="large" />
}
