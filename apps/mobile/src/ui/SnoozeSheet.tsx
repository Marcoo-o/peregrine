import { useState } from 'react'
import { KeyboardAvoidingView, Modal, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CustomSnooze } from './CustomSnooze'
import { snoozeOptions } from './snoozeText'
import { useStyles } from './useStyles'
import { t } from '../i18n'

/**
 * The moments a message can be put aside until, from the bottom of the screen: each preset with the time it comes to,
 * as the desktop offers them, a moment of one's own for what they do not come to, and a line that says where the setting
 * is kept. A tap on one does it and takes the sheet away.
 */
export function SnoozeSheet(props: {
  visible: boolean
  onChoose: (until: number) => void
  onClose: () => void
  /** What the sheet is for, when it is not for putting a message aside. */
  title?: string
  note?: string
}) {
  const styles = useStyles()
  const { bottom } = useSafeAreaInsets()
  const [custom, setCustom] = useState(false)
  const close = () => {
    setCustom(false)
    props.onClose()
  }
  const choose = (until: number) => {
    close()
    props.onChoose(until)
  }
  // Read when the sheet is opened and not when the screen is drawn: "this evening" is a different moment at nine.
  const options = props.visible ? snoozeOptions(new Date()) : []
  return (
    <Modal transparent visible={props.visible} animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
      <Pressable style={styles.sheetBackdrop} onPress={close}>
        {/* A tap inside the sheet is not a tap beside it. */}
        <Pressable style={[styles.sheet, { paddingBottom: 24 + bottom }]} onPress={() => undefined}>
          <Text accessibilityRole="header" style={styles.dialogTitle}>
            {props.title ?? t('Später erinnern')}
          </Text>
          {options.map((option) => (
            <Pressable
              key={option.preset}
              accessibilityRole="button"
              accessibilityLabel={`${option.label}, ${option.when}`}
              style={styles.tagSheetRow}
              onPress={() => choose(option.until)}
            >
              <Text style={styles.sheetText}>{option.label}</Text>
              <View style={styles.fill} />
              <Text style={styles.itemMeta}>{option.when}</Text>
            </Pressable>
          ))}
          {custom ? (
            <CustomSnooze onChoose={choose} />
          ) : (
            <Pressable accessibilityRole="button" style={styles.tagSheetRow} onPress={() => setCustom(true)}>
              <Text style={styles.sheetText}>{t('Eigener Zeitpunkt …')}</Text>
            </Pressable>
          )}
          <Text style={styles.hint}>{props.note ?? t('Gilt nur hier: auf anderen Geräten bleibt die Nachricht im Posteingang.')}</Text>
        </Pressable>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  )
}
