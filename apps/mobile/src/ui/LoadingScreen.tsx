import { View } from 'react-native'
import { Spinner } from './controls'
import { useStyles } from './useStyles'

export function LoadingScreen() {
  const styles = useStyles()
  return (
    <View style={[styles.fill, styles.centerContent]}>
      <Spinner size="large" />
    </View>
  )
}
