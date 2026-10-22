import { Text, View } from 'react-native'
import type { AttachmentInfo } from '../attachments'
import { formatSize, riskText } from '../attachmentText'
import { Chip } from './controls'
import { useStyles } from './useStyles'

/** The attachments of an open message, each with what its name gives away and what can be done with it. */
export function AttachmentList(props: {
  attachments: AttachmentInfo[]
  onSave: (attachment: AttachmentInfo) => void
  onOpen: (attachment: AttachmentInfo) => void
}) {
  const styles = useStyles()
  if (props.attachments.length === 0) return null
  return (
    <View style={styles.attachments}>
      <Text style={styles.section}>Anhänge</Text>
      {props.attachments.map((attachment) => (
        <View key={attachment.id} style={styles.attachment}>
          <Text style={styles.itemTitle}>📎 {attachment.filename}</Text>
          <Text style={styles.itemMeta}>
            {attachment.contentType} · {formatSize(attachment.size)}
          </Text>
          {attachment.findings.map((finding) => (
            <Text key={finding.risk} style={styles.error}>
              {riskText(finding)}
            </Text>
          ))}
          <View style={styles.row}>
            <Chip label="Speichern" active={false} onPress={() => props.onSave(attachment)} />
            <Chip label="Öffnen" active={false} onPress={() => props.onOpen(attachment)} />
          </View>
        </View>
      ))}
    </View>
  )
}
