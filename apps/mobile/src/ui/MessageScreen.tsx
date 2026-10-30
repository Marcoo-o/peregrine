import { useMemo, useState } from 'react'
import { Linking, ScrollView, Text, View } from 'react-native'
import type { LinkAnalysis } from '@peregrine/core/linkSafety'
import type { MessageState } from '../app/screens'
import type { AttachmentInfo } from '../attachments'
import { FLAGGED } from '../flags'
import { assessPage, linksInText, type PageFacts } from '../reading/assessment'
import { hintsFor } from '../reading/hints'
import { tagCoverage, type Tag } from '../tags'
import { parseAddress } from '@peregrine/smtp/headers'
import { roleOf } from '../unified'
import { decideLink } from '../reading/linkGuard'
import { ActionSheet } from './ActionSheet'
import { AttachmentList } from './AttachmentList'
import { Spinner } from './controls'
import { BackBar, Title } from './Header'
import { LinkConfirm } from './LinkConfirm'
import { MailView } from './MailView'
import { MessageActions } from './MessageActions'
import { Notices } from './Notice'
import { SenderBlock } from './SenderBlock'
import { SnoozeSheet } from './SnoozeSheet'
import { TagChips } from './TagChips'
import { TagSheet } from './TagSheet'
import { useTags } from './tags'
import { useSafety } from './safety'
import { useStyles } from './useStyles'

/** When a message was written, for the line under who it is from. */
function writtenAt(dateMs: number | null | undefined): string {
  if (!dateMs) return ''
  return new Date(dateMs).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
}

export function MessageScreen(props: {
  state: MessageState
  onBack: () => void
  onEdit: () => void
  onSetTag: (keyword: string, on: boolean) => void
  onSnooze: (until: number) => void
  onUnsnooze: () => void
  onCreateTag: (name: string, color: string) => Promise<Tag | undefined>
  onReply: () => void
  onReplyAll: () => void
  onForward: () => void
  onToggleSeen: () => void
  onToggleFlag: () => void
  onMove: () => void
  onArchive: () => void
  onJunk: () => void
  onSource: () => void
<<<<<<< HEAD
  onPrint: () => void
=======
  /** Looks for the public key of the sender, on the keyserver and in the directory of the sender's domain. */
  onFindKey: (address: string) => void
>>>>>>> origin/main
  onSaveSource: () => void
  onDelete: () => void
  onSave: (attachment: AttachmentInfo) => void
  onOpenAttachment: (attachment: AttachmentInfo) => void
  onTakeKey: (attachment: AttachmentInfo) => void
}) {
  const styles = useStyles()
  const { account, summary, message, attachments, assessment, notice, error } = props.state
  const known = props.state.knownDomains ?? []
  const safety = useSafety()
  const senderAddress = message ? parseAddress(message.from).address : ''
  const flagged = summary.flags.includes(FLAGGED)

  const [showImages, setShowImages] = useState(false)
  const [facts, setFacts] = useState<PageFacts | null>(null)
  const [pendingLink, setPendingLink] = useState<LinkAnalysis | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [tagging, setTagging] = useState(false)
  const [snoozing, setSnoozing] = useState(false)
  const tags = useTags()

  // A message with a page reports its own links; one without has the addresses that are in its text.
  const page = useMemo(
    () => assessPage(facts ?? { links: message?.html ? [] : linksInText(message?.text ?? ''), images: [] }, known),
    [facts, message, known]
  )
  const remoteImages = facts?.images.filter((image) => /^https?:/i.test(image.src)).length ?? 0
  const hints = hintsFor({ assessment, page, remoteImages, showingImages: showImages, pgp: props.state.protection })

  const followLink = (url: string) => {
    const decision = decideLink(url, facts?.links ?? [], known, { warnSuspicious: safety.warnSuspiciousLinks, confirmAll: safety.confirmAllLinks })
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
        <TagChips flags={summary.flags} all />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!message && !error ? <Spinner /> : null}

        <Notices hints={hints} onAction={() => setShowImages(true)} />
        <AttachmentList attachments={attachments ?? []} onSave={props.onSave} onOpen={props.onOpenAttachment} onTakeKey={props.onTakeKey} />
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

      <MessageActions
        ready={Boolean(message)}
        draft={roleOf(props.state.folder) === 'drafts'}
        onEdit={props.onEdit}
        flagged={flagged}
        onReply={props.onReply}
        onReplyAll={props.onReplyAll}
        onForward={props.onForward}
        onArchive={props.onArchive}
        onToggleFlag={props.onToggleFlag}
        onDelete={props.onDelete}
        onMore={() => setMenuOpen(true)}
      />

      <ActionSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        actions={[
          { label: 'Als ungelesen markieren', onPress: props.onToggleSeen },
          { label: 'Tags …', onPress: () => setTagging(true) },
          summary.snoozedUntil !== null && summary.snoozedUntil > Date.now()
            ? { label: 'Jetzt zurückholen', onPress: props.onUnsnooze }
            : { label: 'Später erinnern …', onPress: () => setSnoozing(true) },
          { label: 'Verschieben …', onPress: props.onMove },
          { label: 'Als Spam markieren', onPress: props.onJunk },
<<<<<<< HEAD
          ...(message ? [{ label: 'Drucken oder als PDF speichern', onPress: props.onPrint }] : []),
=======
          ...(senderAddress ? [{ label: 'Schlüssel des Absenders suchen', onPress: () => props.onFindKey(senderAddress) }] : []),
>>>>>>> origin/main
          ...(props.state.raw
            ? [
                { label: 'Quelltext anzeigen', onPress: props.onSource },
                { label: 'Als .eml speichern', onPress: props.onSaveSource }
              ]
            : [])
        ]}
      />
      <SnoozeSheet visible={snoozing} onChoose={props.onSnooze} onClose={() => setSnoozing(false)} />
      <TagSheet
        visible={tagging}
        tags={tags}
        coverage={(keyword) => tagCoverage([summary.flags], keyword)}
        onSet={props.onSetTag}
        onCreate={props.onCreateTag}
        onClose={() => setTagging(false)}
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
