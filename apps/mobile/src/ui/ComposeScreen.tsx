import { useEffect, useRef, useState } from 'react'
import { BackHandler, Pressable, Text, View } from 'react-native'
import type { ComposeState } from '../app/screens'
import { formatSize } from '../attachmentText'
import { hasRecipient, isChanged, type Draft } from '../draft'
import type { Files } from '../files'
import { Button, Chip, Spinner } from './controls'
import { ConfirmDialog } from './ConfirmDialog'
import { FormInput, FormScroll } from './FormScroll'
import { Header } from './Header'
import { useStyles } from './useStyles'
import { useComposeForm } from './useComposeForm'

export function ComposeScreen(props: {
  state: ComposeState
  files: Files
  onSend: (draft: Draft) => void
  onSaveDraft: (draft: Draft) => void
  onCancel: (draft: Draft) => void
}) {
  const styles = useStyles()
  const { account, busy, error } = props.state
  const form = useComposeForm(props.state.draft, props.files)
  const { draft } = form
  const [discarding, setDiscarding] = useState(false)

  // Leaving with something written asks first, whether it is the button or the back key of the phone.
  const leave = () => (isChanged(props.state.draft, draft) ? setDiscarding(true) : props.onCancel(draft))
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
              props.onCancel(draft)
            }
          }
        ]}
      />
      <Text style={styles.subtitle}>Von {account.emailAddress || account.displayName}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FormInput
        placeholder="An"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={draft.to}
        onChangeText={(to) => form.update({ to })}
      />
      <FormInput
        placeholder="Kopie"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={draft.cc}
        onChangeText={(cc) => form.update({ cc })}
      />
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
      <Chip label="Datei anhängen" active={false} onPress={form.pick} />
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
