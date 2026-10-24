import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import type { Hint } from '../reading/hints'
import { Icon } from './Icon'
import { useStyles } from './useStyles'
import { useTheme } from './useTheme'

type HintAction = NonNullable<Hint['action']>

/**
 * One thing a message has to say for itself. The title says it, and a tap opens what it is based on, so that
 * several of them do not push the message off the screen. What can be done about it is under the title.
 */
export function Notice(props: { hint: Hint; onAction: (action: HintAction) => void }) {
  const styles = useStyles()
  const { colors } = useTheme()
  const [open, setOpen] = useState(false)
  const { hint } = props
  const tone = { danger: styles.noticeDanger, warning: styles.noticeWarning, info: styles.noticeInfo, good: styles.noticeGood }[hint.tone]
  const picture = { danger: colors.danger, warning: colors.warning, info: colors.accent, good: colors.success }[hint.tone]
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      disabled={!hint.detail}
      style={[styles.notice, tone]}
      onPress={() => setOpen((was) => !was)}
    >
      <View style={styles.noticeHead}>
        {hint.icon ? <Icon name={hint.icon} size={20} color={picture} /> : null}
        <Text style={styles.noticeTitle}>{hint.title}</Text>
      </View>
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
