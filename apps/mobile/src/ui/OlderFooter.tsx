import { Text, View } from 'react-native'
import { Button, Spinner } from './controls'
import { useStyles } from './useStyles'

/**
 * What is at the end of a list that has older messages to load: a button, which is a spinner while they are being loaded. Scrolling to
 * the end asks as well, so that the list goes on by itself; the button is for the one who does not know that, and for the list that
 * is too short to scroll.
 */
export function OlderFooter(props: { more: boolean; loading: boolean; onLoad: () => void }) {
  const styles = useStyles()
  if (!props.more) return null
  return (
    <View style={styles.olderFooter}>
      {props.loading ? (
        <>
          <Spinner />
          <Text style={styles.hint}>Ältere Nachrichten werden geladen</Text>
        </>
      ) : (
        <Button label="Ältere Nachrichten laden" variant="secondary" onPress={props.onLoad} />
      )}
    </View>
  )
}
