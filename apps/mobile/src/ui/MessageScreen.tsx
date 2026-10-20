import { useMemo, useState } from 'react'
import { Linking, ScrollView, Text, View } from 'react-native'
import type { LinkAnalysis } from '@peregrine/core/linkSafety'
import type { MessageState } from '../app/screens'
import type { AttachmentInfo } from '../attachments'
import { FLAGGED } from '../flags'
import { assessPage, linksInText, type PageFacts } from '../reading/assessment'
import { hintsFor } from '../reading/hints'
import { decideLink } from '../reading/linkGuard'
import { ActionSheet } from './ActionSheet'
import { AttachmentList } from './AttachmentList'
import { Chip, Spinner } from './controls'
import { BackBar, Title } from './Header'
import { LinkConfirm } from './LinkConfirm'
import { MailView } from './MailView'
import { Notices } from './Notice'
import { SenderBlock } from './SenderBlock'
import { useStyles } from './useStyles'

/** When a message was written, for the line under who it is from. */
function writtenAt(dateMs: number | null | undefined): string {
  if (!dateMs) return ''
  return new Date(dateMs).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
}

export function MessageScreen(props: {
  state: MessageState
  onBack: () => void
  onReply: () => void
  onReplyAll: () => void
  onForward: () => void
  onToggleSeen: () => void
  onToggleFlag: () => void
  onMove: () => void
  onArchive: () => void
  onJunk: () => void
  onDelete: () => void
  onSave: (attachment: AttachmentInfo) => void
  onOpenAttachment: (attachment: AttachmentInfo) => void
}) {
  const styles = useStyles()
  const { account, summary, message, attachments, assessment, notice, error } = props.state
  const known = props.state.knownDomains ?? []
  const flagged = summary.flags.includes(FLAGGED)

  const [showImages, setShowImages] = useState(false)
  const [facts, setFacts] = useState<PageFacts | null>(null)
  const [pendingLink, setPendingLink] = useState<LinkAnalysis | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  // A message with a page reports its own links; one without has the addresses that are in its text.
  const page = useMemo(
    () => assessPage(facts ?? { links: message?.html ? [] : linksInText(message?.text ?? ''), images: [] }, known),
    [facts, message, known]
  )
  const remoteImages = facts?.images.filter((image) => /^https?:/i.test(image.src)).length ?? 0
  const hints = hintsFor({ assessment, page, remoteImages, showingImages: showImages })

  const followLink = (url: string) => {
    const decision = decideLink(url, facts?.links ?? [], known)
    if (decision.action === 'open') Linking.openURL(decision.url).catch(() => undefined)
    else if (decision.action === 'confirm') setPendingLink(decision.analysis)
  }

  return (
    <View style={styles.fill}>
      <BackBar label="Zurück" onPress={props.onBack} />
      <ScrollView style={styles.fill} contentContainerStyle={styles.form}>
        <Title text={message?.subject || summary.subject || '(ohne Betreff)'} />
        <SenderBlock
          from={message?.from || summary.sender}
          to={message?.to ?? ''}
          cc={message?.cc ?? ''}
          color={account.color}
        />
        <Text style={styles.itemMeta}>{writtenAt(summary.dateMs)}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!message && !error ? <Spinner /> : null}

        <Notices hints={hints} onAction={() => setShowImages(true)} />
        <AttachmentList attachments={attachments ?? []} onSave={props.onSave} onOpen={props.onOpenAttachment} />
        {notice ? <Text style={styles.hint}>{notice}</Text> : null}

        {message?.html ? (
          <MailView
            html={message.html}
            inlineImages={message.inlineImages}
            allowRemoteImages={showImages}
            onFacts={setFacts}
            onLink={followLink}
          />
        ) : (
          <Text selectable style={styles.body}>
            {message?.text ?? ''}
          </Text>
        )}
      </ScrollView>

      <View style={styles.actionBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionBarContent}>
          <Chip label="Antworten" active={false} onPress={props.onReply} disabled={!message} />
          <Chip label="Allen antworten" active={false} onPress={props.onReplyAll} disabled={!message} />
          <Chip label="Weiterleiten" active={false} onPress={props.onForward} disabled={!message} />
          <Chip label={flagged ? '★' : '☆'} active={flagged} onPress={props.onToggleFlag} />
          <Chip label="Mehr …" active={false} onPress={() => setMenuOpen(true)} />
        </ScrollView>
      </View>

      <ActionSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        actions={[
          { label: 'Als ungelesen markieren', onPress: props.onToggleSeen },
          { label: flagged ? 'Markierung entfernen' : 'Markieren', onPress: props.onToggleFlag },
          { label: 'Verschieben …', onPress: props.onMove },
          { label: 'Archivieren', onPress: props.onArchive },
          { label: 'Als Spam markieren', onPress: props.onJunk },
          { label: 'Löschen', onPress: props.onDelete, danger: true }
        ]}
      />
      <LinkConfirm
        analysis={pendingLink}
        onCancel={() => setPendingLink(null)}
        onOpen={(url) => {
          setPendingLink(null)
          Linking.openURL(url).catch(() => undefined)
        }}
      />
    </View>
  )
}
