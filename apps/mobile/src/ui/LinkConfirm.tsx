import { Modal, Pressable, Text, View } from 'react-native'
import type { LinkAnalysis } from '@peregrine/core/linkSafety'
import { linkFindingText } from '../reading/warningText'
import { Button } from './controls'
import { useStyles } from './useStyles'
import { t } from '../i18n'

/**
 * Shown before a link that does not lead where it reads is opened, as the desktop shows it: what is wrong
 * with it, and where it leads, spelled out the way the browser will read it. Not opening is the first and the
 * filled button, so that a tap that was meant for something else does not open it.
 */
export function LinkConfirm(props: { analysis: LinkAnalysis | null; onCancel: () => void; onOpen: (url: string) => void }) {
  const styles = useStyles()
  const { analysis } = props
  return (
    <Modal transparent visible={analysis !== null} animationType="fade" onRequestClose={props.onCancel}>
      <Pressable style={styles.backdrop} onPress={props.onCancel}>
        {analysis ? (
          // A tap inside the dialog is not a tap beside it.
          <Pressable style={styles.dialog} onPress={() => undefined}>
            <Text accessibilityRole="header" style={styles.dialogTitle}>
              {t('Dieser Link führt woanders hin, als er aussieht')}
            </Text>
            {analysis.findings.map((finding) => {
              const text = linkFindingText(finding)
              return (
                <View key={finding.risk}>
                  <Text style={styles.noticeTitle}>{text.title}</Text>
                  <Text style={styles.noticeDetail}>{text.detail}</Text>
                </View>
              )
            })}
            <Text style={styles.section}>{t('Tatsächliches Ziel')}</Text>
            <Text selectable style={styles.mono}>
              {analysis.displayHost}
            </Text>
            <Text selectable style={styles.itemMeta}>
              {analysis.href}
            </Text>
            <Button label={t('Nicht öffnen')} onPress={props.onCancel} />
            <Button label={t('Trotzdem öffnen')} variant="danger" onPress={() => props.onOpen(analysis.href)} />
          </Pressable>
        ) : (
          <View />
        )}
      </Pressable>
    </Modal>
  )
}
