import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import type { Hint } from '../reading/hints'
import { useStyles } from './useStyles'

type HintAction = NonNullable<Hint['action']>

/**
 * One thing a message has to say for itself. The title says it, and a tap opens what it is based on, so that
 * several of them do not push the message off the screen. What can be done about it is under the title.
 */
export function Notice(props: { hint: Hint; onAction: (action: HintAction) => void }) {
  const styles = useStyles()
  const [open, setOpen] = useState(false)
  const { hint } = props
  const tone = { danger: styles.noticeDanger, warning: styles.noticeWarning, info: styles.noticeInfo }[hint.tone]
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      disabled={!hint.detail}
      style={[styles.notice, tone]}
      onPress={() => setOpen((was) => !was)}
    >
      <Text style={styles.noticeTitle}>{hint.title}</Text>
      {open && hint.detail ? <Text style={styles.noticeDetail}>{hint.detail}</Text> : null}
      {hint.action === 'showImages' ? (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => props.onAction('showImages')}>
          <Text style={styles.noticeAction}>Bilder anzeigen</Text>
        </Pressable>
      ) : null}
    </Pressable>
  )
}

/** The hints of a message, one under the other. */
export function Notices(props: { hints: Hint[]; onAction: (action: HintAction) => void }) {
  if (props.hints.length === 0) return null
  return (
    <View>
      {props.hints.map((hint) => (
        <Notice key={hint.id} hint={hint} onAction={props.onAction} />
      ))}
    </View>
  )
}
