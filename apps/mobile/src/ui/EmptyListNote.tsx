import { Text } from 'react-native'
import { useStyles } from './useStyles'
import { t } from '../i18n'

/**
 * What a list says when it shows nothing, beyond what the line over it already says. That line says that there are
 * no messages; it is only when there are some, and the filters leave none, that the list has to explain itself.
 */
export function EmptyListNote(props: { busy: boolean; total: number }) {
  const styles = useStyles()
  if (props.busy || props.total === 0) return null
  return <Text style={styles.hint}>{t('Keine Nachricht passt zu den Filtern.')}</Text>
}
