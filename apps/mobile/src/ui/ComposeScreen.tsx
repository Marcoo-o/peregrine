import { useEffect, useRef, useState } from 'react'
import { BackHandler, Pressable, Text, View } from 'react-native'
import type { ComposeState } from '../app/screens'
import { formatSize } from '../attachmentText'
import { withContact, type Contact } from '../contacts'
import { hasRecipient, isChanged, type Draft } from '../draft'
import { autosaveText } from './autosaveText'
import type { Files } from '../files'
import { Button, Chip, Spinner, SwitchRow } from './controls'
import { ConfirmDialog } from './ConfirmDialog'
import { FormInput, FormScroll } from './FormScroll'
import { Header } from './Header'
import { SuggestionList } from './SuggestionList'
import { useStyles } from './useStyles'
import { useAutosave } from './useAutosave'
import { useComposeForm } from './useComposeForm'
import { useSuggestions } from './useSuggestions'

export function ComposeScreen(props: {
  state: ComposeState
  files: Files
  /** The people to suggest for an address that is being typed. */
  suggest: (typed: string) => Promise<Contact[]>
  onSend: (draft: Draft) => void
  onSaveDraft: (draft: Draft) => void
  /** Keeps the message as a draft without leaving, which is done once writing has paused. */
  onAutosave: (draft: Draft) => void
  onCancel: (draft: Draft) => void
  /** Throws the message away, with the draft that was kept of it. */
  onDiscard: (draft: Draft) => void
}) {
  const styles = useStyles()
  const { account, busy, error } = props.state
  const form = useComposeForm(props.state.draft, props.files)
  const { draft } = form
  const [discarding, setDiscarding] = useState(false)
  const [typing, setTyping] = useState<'to' | 'cc' | 'bcc' | null>(null)
  const forTo = useSuggestions(props.suggest, draft.to, typing === 'to')
  const forCc = useSuggestions(props.suggest, draft.cc, typing === 'cc')
  const forBcc = useSuggestions(props.suggest, draft.bcc, typing === 'bcc')

  useAutosave(props.state, draft, props.onAutosave)

  // Leaving with something written that has not been kept asks first, whether it is the button or the back key of the
  // phone. What has been kept, by hand or by itself, stays where it is kept, and nothing needs asking.
  const leave = () => (isChanged(props.state.savedDraft ?? props.state.draft, draft) ? setDiscarding(true) : props.onCancel(draft))
  const leaving = useRef(leave)
  leaving.current = leave
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      leaving.current()
      return true
    })
    return () => subscription.remove()
  }, [])

  return (
    <FormScroll>
      <Header title="Neue Nachricht" back={{ label: 'Abbrechen', onPress: leave }} />
      <ConfirmDialog
        visible={discarding}
        title="Nachricht noch nicht gesendet"
        text="Die Nachricht kann als Entwurf behalten und später weitergeschrieben werden. Wird sie verworfen, geht sie verloren."
        answers={[
          { label: 'Weiter schreiben', onPress: () => setDiscarding(false) },
          {
            label: 'Als Entwurf speichern',
            variant: 'secondary',
            onPress: () => {
              setDiscarding(false)
              props.onSaveDraft(draft)
            }
          },
          {
            label: 'Verwerfen',
            variant: 'danger',
            onPress: () => {
              setDiscarding(false)
              props.onDiscard(draft)
            }
          }
        ]}
      />
      <Text style={styles.subtitle}>Von {account.emailAddress || account.displayName}</Text>
      {props.state.autosave ? <Text style={styles.hint}>{autosaveText(props.state.autosave)}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FormInput
        placeholder="An"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={draft.to}
        onChangeText={(to) => form.update({ to })}
        onFocus={() => setTyping('to')}
        onBlur={() => setTyping((now) => (now === 'to' ? null : now))}
      />
      <SuggestionList contacts={forTo} onChoose={(contact) => form.update({ to: withContact(draft.to, contact) })} />
      <FormInput
        placeholder="Kopie"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={draft.cc}
        onChangeText={(cc) => form.update({ cc })}
        onFocus={() => setTyping('cc')}
        onBlur={() => setTyping((now) => (now === 'cc' ? null : now))}
      />
      <SuggestionList contacts={forCc} onChoose={(contact) => form.update({ cc: withContact(draft.cc, contact) })} />
      <FormInput
        placeholder="Bcc (verdeckt)"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={draft.bcc}
        onChangeText={(bcc) => form.update({ bcc })}
        onFocus={() => setTyping('bcc')}
        onBlur={() => setTyping((now) => (now === 'bcc' ? null : now))}
      />
      <SuggestionList contacts={forBcc} onChoose={(contact) => form.update({ bcc: withContact(draft.bcc, contact) })} />
      <FormInput
        placeholder="Betreff"
        value={draft.subject}
        onChangeText={(subject) => form.update({ subject })}
      />
      <FormInput
        style={styles.multiline}
        placeholder="Nachricht"
        multiline
        textAlignVertical="top"
        value={draft.body}
        onChangeText={(body) => form.update({ body })}
      />
      {draft.attachments.map((attached) => (
        <View key={attached.path} style={styles.attachment}>
          <Text style={styles.itemTitle}>📎 {attached.filename}</Text>
          <Text style={styles.itemMeta}>{formatSize(attached.size)}</Text>
          <Pressable onPress={() => form.detach(attached.path)}>
            <Text style={styles.link}>Entfernen</Text>
          </Pressable>
        </View>
      ))}
      {form.notice ? <Text style={styles.error}>{form.notice}</Text> : null}
      <View style={styles.actions}>
        <Chip label="Datei anhängen" active={false} icon="attachment" onPress={form.pick} />
      </View>
      <Text style={styles.section}>Schutz</Text>
      <View style={styles.group}>
        <SwitchRow
          label="Verschlüsseln"
          hint="Nur die Empfänger können den Inhalt lesen. Für jeden braucht es einen Schlüssel."
          value={draft.encrypt === true}
          onChange={(encrypt) => form.update({ encrypt })}
        />
        <SwitchRow
          label="Signieren"
          hint={draft.encrypt ? 'Beim Verschlüsseln immer dabei.' : 'Die Empfänger können prüfen, dass die Nachricht von dir kommt.'}
          value={draft.encrypt === true || draft.sign === true}
          disabled={draft.encrypt === true}
          onChange={(sign) => form.update({ sign })}
        />
      </View>
      {draft.encrypt || draft.sign ? (
        <Text style={styles.hint}>Geschützt wird der Inhalt mit den Anhängen. Absender, Empfänger und Betreff bleiben lesbar, weil der Mailserver sie braucht.</Text>
      ) : null}
      {form.confirming ? (
        <Text style={styles.error}>
          Du schreibst von einem Anhang, aber es ist keiner angehängt. Tippe noch einmal, wenn die Nachricht so raus soll.
        </Text>
      ) : null}
      {busy ? <Spinner /> : null}
      <Button
        label={form.confirming ? 'Trotzdem senden' : 'Senden'}
        disabled={busy || !hasRecipient(draft)}
        onPress={() => form.mayGo() && props.onSend(draft)}
      />
    </FormScroll>
  )
}
