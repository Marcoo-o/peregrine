import { Pressable, Text } from 'react-native'
import type { ScheduledState } from '../app/screens'
import { Header } from './Header'
import { FormScroll } from './FormScroll'
import { momentText } from './snoozeText'
import { useStyles } from './useStyles'
import { t } from '../i18n'

/** The messages that wait for a moment: to whom, what about, when they go, and the way to take one back to write on it. */
export function ScheduledScreen(props: { state: ScheduledState; onTakeBack: (id: number) => void; onBack: () => void }) {
  const styles = useStyles()
  const { items } = props.state
  return (
    <FormScroll>
      <Header title={t('Geplante Nachrichten')} back={{ label: t('Zurück'), onPress: props.onBack }} />
      {items.length === 0 ? <Text style={styles.hint}>{t('Es ist nichts geplant.')}</Text> : null}
      {items.map((item) => (
        <Pressable key={item.id} accessibilityRole="button" style={styles.attachment} onPress={() => props.onTakeBack(item.id)}>
          <Text style={styles.itemTitle}>{item.subject === '' ? t('(ohne Betreff)') : item.subject}</Text>
          <Text style={styles.itemMeta}>{`An ${item.to}, geht ${momentText(item.dueAt)}`}</Text>
          <Text style={styles.link}>{t('Zurücknehmen und weiterschreiben')}</Text>
        </Pressable>
      ))}
    </FormScroll>
  )
}
