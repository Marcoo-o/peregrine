import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import type { ComposeState } from '../app/screens'
import { formatSize } from '../attachmentText'
import { hasRecipient, type Draft } from '../draft'
import type { Files } from '../files'
import { BackLink, Button, Chip } from './controls'
import { styles } from './styles'
import { useComposeForm } from './useComposeForm'

export function ComposeScreen(props: {
  state: ComposeState
  files: Files
  onSend: (draft: Draft) => void
  onCancel: (draft: Draft) => void
}) {
  const { account, busy, error } = props.state
  const form = useComposeForm(props.state.draft, props.files)
  const { draft } = form

  return (
    <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
      <BackLink label="‹ Abbrechen" onPress={() => props.onCancel(draft)} />
      <Text style={styles.title}>Neue Nachricht</Text>
      <Text style={styles.itemMeta}>Von {account.emailAddress || account.displayName}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TextInput
        style={styles.input}
        placeholder="An"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={draft.to}
        onChangeText={(to) => form.update({ to })}
      />
      <TextInput
        style={styles.input}
        placeholder="Kopie"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={draft.cc}
        onChangeText={(cc) => form.update({ cc })}
      />
      <TextInput
        style={styles.input}
        placeholder="Betreff"
        value={draft.subject}
        onChangeText={(subject) => form.update({ subject })}
      />
      <TextInput
        style={[styles.input, styles.multiline]}
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
      {busy ? <ActivityIndicator style={styles.spinner} /> : null}
      <Button
        label={form.confirming ? 'Trotzdem senden' : 'Senden'}
        disabled={busy || !hasRecipient(draft)}
        onPress={() => form.mayGo() && props.onSend(draft)}
      />
    </ScrollView>
  )
}
