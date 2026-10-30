import { Text } from 'react-native'
import type { SourceState } from '../app/screens'
import { FormScroll } from './FormScroll'
import { Header } from './Header'
import { useStyles } from './useStyles'

/** A message as the server has it: the text that can be selected and copied, in a type where every character is as wide as the next. */
export function SourceScreen(props: { state: SourceState; onBack: () => void }) {
  const styles = useStyles()
  return (
    <FormScroll>
      <Header title="Quelltext" back={{ label: 'Nachricht', onPress: props.onBack }} />
      {props.state.truncated ? <Text style={styles.hint}>Nur der Anfang der Nachricht ist hier. Ganz lässt sie sich als .eml speichern.</Text> : null}
      <Text selectable style={styles.source}>
        {props.state.text}
      </Text>
    </FormScroll>
  )
}
