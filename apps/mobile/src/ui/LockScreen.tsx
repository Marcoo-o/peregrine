import { useEffect } from 'react'
import { Text, View } from 'react-native'
import { Button } from './controls'
import { useStyles } from './useStyles'
import { t } from '../i18n'

/** What is shown instead of the mail while the application is locked. It asks for the screen lock when it appears. */
export function LockScreen(props: { onUnlock: () => void }) {
  const styles = useStyles()
  // Asked for as soon as it is shown, since there is nothing else to do here, and again by the button when it was cancelled.
  useEffect(() => {
    props.onUnlock()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <View style={styles.lockScreen}>
      <Text accessibilityRole="header" style={styles.lockTitle}>
        {t('Peregrine ist gesperrt')}
      </Text>
      <Text style={styles.hint}>{t('Gib die Bildschirmsperre dieses Telefons ein, um deine Nachrichten zu sehen.')}</Text>
      <Button label={t('Entsperren')} onPress={props.onUnlock} />
    </View>
  )
}
