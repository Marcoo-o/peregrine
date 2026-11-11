import { Modal, Pressable, Text } from 'react-native'
import type { UnsubscribeAdvice, UnsubscribeMode } from '@peregrine/core/unsubscribe'
import { Button } from './controls'
import { useStyles } from './useStyles'
import { t } from '../i18n'

/** What the way to do it will do, in words: the user is to know what happens before they agree, and to what address. */
function doing(mode: UnsubscribeMode, target: string): string {
  if (mode === 'one-click') {
    return t('Peregrine schickt eine einzige Abmelde-Anfrage an {target}. Es wird nichts anderes gesendet, ohne Cookies und ohne Anmeldung.', { target })
  }
  if (mode === 'mail') return t('Peregrine bereitet eine Nachricht an {target} vor. Du siehst sie und sendest sie selbst.', { target })
  return t('Die Seite von {target} wird im Browser geöffnet. Dort meldest du dich selbst ab.', { target })
}

/** The words on the button that does it. */
const GO: Record<UnsubscribeMode, () => string> = {
  'one-click': () => t('Jetzt abmelden'),
  mail: () => t('Nachricht vorbereiten'),
  page: () => t('Seite öffnen')
}

/**
 * Shown before a message is unsubscribed from, whatever the way: where the request goes, and what is odd about it. A message that looks wrong
 * is not offered a way at all, only the reason, and marking it as spam, which is what a message that pretends to be a newsletter deserves.
 */
export function UnsubscribeSheet(props: {
  advice: UnsubscribeAdvice | null
  senderDomain: string
  onCancel: () => void
  onGo: (mode: UnsubscribeMode) => void
  onJunk: () => void
}) {
  const styles = useStyles()
  const { advice } = props
  return (
    <Modal transparent visible={advice !== null} animationType="fade" onRequestClose={props.onCancel}>
      <Pressable style={styles.backdrop} onPress={props.onCancel}>
        {advice ? (
          // A tap inside the dialog is not a tap beside it.
          <Pressable style={styles.dialog} onPress={() => undefined}>
            <Text accessibilityRole="header" style={styles.dialogTitle}>
              {advice.blocked ? t('Hier lieber nicht abmelden') : t('Vom Newsletter abmelden')}
            </Text>
            {advice.blocked ? (
              <Text style={styles.noticeDetail}>
                {t('Diese Nachricht sieht verdächtig aus: der Server hält sie für Spam, eine Prüfung ist fehlgeschlagen, oder der Absender gibt sich als jemand anderes aus. Eine Abmeldung würde ihm nur zeigen, dass die Adresse gelesen wird. Markiere sie lieber als Spam.')}
              </Text>
            ) : advice.mode ? (
              <>
                <Text style={styles.noticeDetail}>{doing(advice.mode, advice.target)}</Text>
                {advice.cautions.includes('first-contact') ? (
                  <Text style={styles.noticeDetail}>
                    {t('Von diesem Absender hast du sonst nichts. Eine Abmeldung verrät ihm, dass die Adresse gelesen wird.')}
                  </Text>
                ) : null}
                {advice.cautions.includes('other-site') ? (
                  <Text style={styles.noticeDetail}>
                    {t('Die Adresse gehört nicht zur Domain des Absenders ({sender}). Das ist bei Diensten üblich, die Newsletter für andere verschicken, und trotzdem gut zu wissen.', {
                      sender: props.senderDomain
                    })}
                  </Text>
                ) : null}
              </>
            ) : null}
            {advice.blocked ? <Button label={t('Als Spam markieren')} variant="danger" onPress={props.onJunk} /> : null}
            {advice.mode ? <Button label={GO[advice.mode]()} onPress={() => props.onGo(advice.mode as UnsubscribeMode)} /> : null}
            <Button label={t('Abbrechen')} variant="secondary" onPress={props.onCancel} />
          </Pressable>
        ) : null}
      </Pressable>
    </Modal>
  )
}
