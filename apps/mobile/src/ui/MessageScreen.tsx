import { ActivityIndicator, ScrollView, Text, View } from 'react-native'
import type { MessageState } from '../app/screens'
import type { AttachmentInfo } from '../attachments'
import { FLAGGED } from '../flags'
import { AttachmentList } from './AttachmentList'
import { BackLink, Chip } from './controls'
import { styles } from './styles'

export function MessageScreen(props: {
  state: MessageState
  onBack: () => void
  onReply: () => void
  onToggleSeen: () => void
  onToggleFlag: () => void
  onMove: () => void
  onDelete: () => void
  onSave: (attachment: AttachmentInfo) => void
  onOpenAttachment: (attachment: AttachmentInfo) => void
}) {
  const { summary, message, attachments, notice, error } = props.state
  const flagged = summary.flags.includes(FLAGGED)
  return (
    <View style={styles.fill}>
      <BackLink label="‹ Zurück" onPress={props.onBack} />
      <Text style={styles.title}>{message?.subject || summary.subject || '(ohne Betreff)'}</Text>
      <Text style={styles.itemMeta}>{message?.from || summary.sender}</Text>
      <View style={styles.actions}>
        <Chip label="Antworten" active={false} onPress={props.onReply} disabled={!message} />
        <Chip label="Ungelesen" active={false} onPress={props.onToggleSeen} />
        <Chip label={flagged ? '★ Markiert' : '☆ Markieren'} active={flagged} onPress={props.onToggleFlag} />
        <Chip label="Verschieben" active={false} onPress={props.onMove} />
        <Chip label="Löschen" active={false} onPress={props.onDelete} />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!message && !error ? <ActivityIndicator style={styles.spinner} /> : null}
      <ScrollView style={styles.fill}>
        <Text selectable style={styles.body}>
          {message?.text ?? ''}
        </Text>
        <AttachmentList attachments={attachments ?? []} onSave={props.onSave} onOpen={props.onOpenAttachment} />
        {notice ? <Text style={styles.hint}>{notice}</Text> : null}
      </ScrollView>
    </View>
  )
}
