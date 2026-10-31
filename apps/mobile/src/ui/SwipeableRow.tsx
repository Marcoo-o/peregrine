import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, PanResponder, Text, View } from 'react-native'
import { Icon } from './Icon'
import { COMMIT_FRACTION, isSwipe, swipeResult } from './swipe'
import { useStyles } from './useStyles'
import { useTheme } from './useTheme'
import { t } from '../i18n'

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

  // How far the row is from where it rests, whichever way, as what the pictures under it are made of: the box that
  // comes out grows with it, and its picture shows after a first bit and grows once it is far enough to count.
  const reachedRight = x.interpolate({ inputRange: [0, 10_000], outputRange: [0, 10_000], extrapolateLeft: 'clamp' })
  const reachedLeft = x.interpolate({ inputRange: [-10_000, 0], outputRange: [10_000, 0], extrapolateRight: 'clamp' })
  const distance = x.interpolate({ inputRange: [-10_000, 0, 10_000], outputRange: [10_000, 0, 10_000] })
  const needed = Math.max(width * COMMIT_FRACTION, 1)
  const shown = distance.interpolate({ inputRange: [0, 24, 64], outputRange: [0, 0, 1], extrapolate: 'clamp' })
  const grown = distance.interpolate({ inputRange: [0, needed, needed + 1], outputRange: [0.8, 1.15, 1.15], extrapolate: 'clamp' })

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
        { name: 'archive', label: t('Archivieren') },
        { name: 'delete', label: t('Löschen') }
      ]}
      onAccessibilityAction={(event) => (event.nativeEvent.actionName === 'archive' ? props.onArchive() : props.onDelete())}
    >
      {/* Each side is as wide as the row has been moved to it, so nothing is behind a row that is at rest. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.swipeSide, styles.swipeSideLeft, { backgroundColor: colors.success, width: reachedRight }]}
      >
        <Animated.View style={[styles.swipeContent, { opacity: shown, transform: [{ scale: grown }] }]}>
          <Icon name="archive" size={22} color={colors.onAccent} />
          <Text style={styles.swipeLabel} numberOfLines={1}>{t('Archivieren')}</Text>
        </Animated.View>
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[styles.swipeSide, styles.swipeSideRight, { backgroundColor: colors.danger, width: reachedLeft }]}
      >
        <Animated.View style={[styles.swipeContent, { opacity: shown, transform: [{ scale: grown }] }]}>
          <Icon name="trash" size={22} color={colors.onAccent} />
          <Text style={styles.swipeLabel} numberOfLines={1}>{t('Löschen')}</Text>
        </Animated.View>
      </Animated.View>
      <Animated.View style={[styles.swipeRow, { transform: [{ translateX: x }] }]} {...responder.panHandlers}>
        {props.children}
      </Animated.View>
    </View>
  )
}
