import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, PanResponder, Text, View } from 'react-native'
import { Icon } from './Icon'
import { isSwipe, swipeResult } from './swipe'
import { useStyles } from './useStyles'
import { useTheme } from './useTheme'

/**
 * A row of a list that can be swiped sideways to do something to it: to the right archives, to the left deletes, as
 * the picture that comes out from under the row says. A touch that goes mostly up or down is the list's own, and is
 * not taken from it. Where a screen reader or a keyboard is used the same two things are offered as actions of the
 * row, since nobody can swipe there.
 */
export function SwipeableRow(props: {
  children: ReactNode
  /** Whether the row is left to be tapped only, which it is while messages are being chosen. */
  disabled?: boolean
  onArchive: () => void
  onDelete: () => void
}) {
  const styles = useStyles()
  const { colors } = useTheme()
  const x = useRef(new Animated.Value(0)).current
  const [width, setWidth] = useState(0)
  // The responder is made once, and reads what is current when it is asked.
  const current = useRef({ width, disabled: props.disabled, onArchive: props.onArchive, onDelete: props.onDelete })
  current.current = { width, disabled: props.disabled, onArchive: props.onArchive, onDelete: props.onDelete }

  useEffect(() => () => x.stopAnimation(), [x])

  const responder = useMemo(() => {
    const back = () => Animated.spring(x, { toValue: 0, useNativeDriver: false, bounciness: 0 }).start()
    const finish = (direction: 1 | -1, action: () => void) => {
      Animated.timing(x, { toValue: direction * current.current.width, duration: 120, useNativeDriver: false }).start(() => {
        action()
        // What was done may leave the row where it is (a move that waits for a connection), and then it is to be seen again.
        x.setValue(0)
      })
    }
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_event, gesture) => !current.current.disabled && isSwipe(gesture.dx, gesture.dy),
      onPanResponderMove: (_event, gesture) => x.setValue(gesture.dx),
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: (_event, gesture) => {
        const result = swipeResult(gesture.dx, current.current.width)
        if (result === 'archive') finish(1, current.current.onArchive)
        else if (result === 'delete') finish(-1, current.current.onDelete)
        else back()
      },
      onPanResponderTerminate: back
    })
  }, [x])

  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      accessibilityActions={[
        { name: 'archive', label: 'Archivieren' },
        { name: 'delete', label: 'Löschen' }
      ]}
      onAccessibilityAction={(event) => (event.nativeEvent.actionName === 'archive' ? props.onArchive() : props.onDelete())}
    >
      <View style={styles.swipeUnder} pointerEvents="none">
        <View style={[styles.swipeSide, { backgroundColor: colors.success, alignItems: 'flex-start' }]}>
          <Icon name="archive" size={22} color={colors.onAccent} />
          <Text style={styles.swipeLabel}>Archivieren</Text>
        </View>
        <View style={[styles.swipeSide, { backgroundColor: colors.danger, alignItems: 'flex-end' }]}>
          <Icon name="trash" size={22} color={colors.onAccent} />
          <Text style={styles.swipeLabel}>Löschen</Text>
        </View>
      </View>
      <Animated.View style={[styles.swipeRow, { transform: [{ translateX: x }] }]} {...responder.panHandlers}>
        {props.children}
      </Animated.View>
    </View>
  )
}
