import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import type { UndoState } from '../app/store'
import { useStyles } from './useStyles'

/** How long what is said of a message that was too late to take back stays on the screen. */
const LATE_MS = 4000

/**
 * The line that is over every screen for the few seconds a message that was sent can be taken back: what it is, how long is left, and the
 * way to take it back. When the time is over it is gone; when the way was tried too late it says so for a moment and is gone.
 */
export function UndoBar(props: { undo: UndoState; onUndo: () => void; onDone: () => void }) {
  const styles = useStyles()
  const { undo } = props
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const ends = undo.late ? Date.now() + LATE_MS : undo.until
    const tick = setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= ends) props.onDone()
    }, 250)
    return () => clearInterval(tick)
  }, [undo, props.onDone])

  const seconds = Math.max(0, Math.ceil((undo.until - now) / 1000))
  return (
    <View style={styles.undoBar}>
      <Text style={styles.undoText} numberOfLines={1}>
        {undo.late ? 'Zu spät, die Nachricht ist schon unterwegs.' : `Wird gesendet${undo.subject ? `: ${undo.subject}` : ''}`}
      </Text>
      {undo.late ? null : (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={props.onUndo}>
          <Text style={styles.undoAction}>Rückgängig ({seconds})</Text>
        </Pressable>
      )}
    </View>
  )
}
