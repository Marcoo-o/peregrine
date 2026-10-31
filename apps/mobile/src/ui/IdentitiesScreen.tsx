import { useEffect, useState } from 'react'
import { Pressable, Text } from 'react-native'
import type { IdentityFields } from '../app/SenderController'
import type { IdentitiesState } from '../app/screens'
import type { Identity } from '../identities'
import { Button } from './controls'
import { ConfirmDialog } from './ConfirmDialog'
import { FormInput, FormScroll } from './FormScroll'
import { Header } from './Header'
import { useStyles } from './useStyles'
import { t } from '../i18n'

/** What is being edited: one of the identities, a new one, or none, which is the list. */
type Editing = Identity | 'new' | null

/** Whether an identity has a name of its own: one that is only the address again says nothing, and would show twice. */
const named = (identity: Identity): boolean => identity.displayName !== '' && identity.displayName !== identity.emailAddress

const EMPTY: IdentityFields = { displayName: '', emailAddress: '', signature: '' }

function fieldsOf(editing: Editing): IdentityFields {
  return editing === null || editing === 'new'
    ? EMPTY
    : { displayName: editing.displayName, emailAddress: editing.emailAddress, signature: editing.signature }
}

/** The addresses an account sends under: a list of them, and a form for the one that is chosen or a new one. */
export function IdentitiesScreen(props: {
  state: IdentitiesState
  onSave: (id: string | null, fields: IdentityFields) => void
  onMakeDefault: (id: string) => void
  onRemove: (id: string) => void
  onBack: () => void
}) {
  const styles = useStyles()
  const { account, identities, notice, error } = props.state
  const [editing, setEditing] = useState<Editing>(null)
  const [fields, setFields] = useState<IdentityFields>(EMPTY)
  const [removing, setRemoving] = useState(false)
  // What was done is said above the list, which is where the screen goes back to; a refusal leaves the form as it was typed.
  useEffect(() => {
    if (notice) setEditing(null)
  }, [notice, identities])
  const set = (patch: Partial<IdentityFields>) => setFields((current) => ({ ...current, ...patch }))
  const open = (next: Editing) => {
    setEditing(next)
    setFields(fieldsOf(next))
  }

  const status = (
    <>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.hint}>{notice}</Text> : null}
    </>
  )

  if (editing === null) {
    return (
      <FormScroll>
        <Header title={t('Absender und Signatur')} back={{ label: account.displayName, onPress: props.onBack }} />
        {status}
        <Text style={styles.hint}>
          {t('Die Adressen, unter denen sich mit diesem Konto schreiben lässt, jede mit ihrem Namen und ihrer Signatur. Der erste Absender ist der, mit dem eine neue Nachricht beginnt. Beim Schreiben lässt sich ein anderer wählen.')}
        </Text>
        {identities.map((identity) => (
          <Pressable key={identity.id} accessibilityRole="button" style={styles.attachment} onPress={() => open(identity)}>
            <Text style={styles.itemTitle}>{named(identity) ? identity.displayName : identity.emailAddress}</Text>
            <Text style={styles.itemMeta}>{[named(identity) ? identity.emailAddress : null, identity.isDefault ? t('Standard') : null].filter(Boolean).join('  ')}</Text>
          </Pressable>
        ))}
        <Button label={t('Absender hinzufügen')} variant="secondary" onPress={() => open('new')} />
      </FormScroll>
    )
  }

  const isNew = editing === 'new'
  const current = isNew ? null : editing
  return (
    <FormScroll>
      <Header title={isNew ? t('Neuer Absender') : t('Absender')} back={{ label: t('Absender und Signatur'), onPress: () => setEditing(null) }} />
      {status}
      <FormInput placeholder={t('Name (wie er beim Empfänger steht)')} value={fields.displayName} onChangeText={(displayName) => set({ displayName })} />
      <FormInput
        placeholder={t('E-Mail-Adresse')}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={fields.emailAddress}
        onChangeText={(emailAddress) => set({ emailAddress })}
      />
      <Text style={styles.section}>{t('Signatur')}</Text>
      <FormInput
        style={styles.multiline}
        placeholder={t('Text unter der Nachricht')}
        multiline
        textAlignVertical="top"
        value={fields.signature}
        onChangeText={(signature) => set({ signature })}
      />
      <Text style={styles.hint}>{t('Sie steht unter dem Text, nach einer Zeile mit zwei Strichen, und wechselt mit dem Absender.')}</Text>
      <Button label={t('Speichern')} disabled={fields.emailAddress.trim() === ''} onPress={() => props.onSave(current?.id ?? null, fields)} />
      {current && !current.isDefault ? (
        <Button label={t('Als Standard festlegen')} variant="secondary" onPress={() => props.onMakeDefault(current.id)} />
      ) : null}
      {current ? <Button label={t('Absender entfernen')} variant="danger" onPress={() => setRemoving(true)} /> : null}
      <ConfirmDialog
        visible={removing}
        title={t('Absender entfernen?')}
        text={t('Der Absender wird von diesem Gerät entfernt. Nachrichten, die schon gesendet sind, bleiben, wie sie sind.')}
        answers={[
          { label: t('Abbrechen'), onPress: () => setRemoving(false) },
          {
            label: t('Absender entfernen'),
            variant: 'danger',
            onPress: () => {
              setRemoving(false)
              setEditing(null)
              if (current) props.onRemove(current.id)
            }
          }
        ]}
      />
    </FormScroll>
  )
}
