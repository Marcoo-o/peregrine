import { useEffect, useMemo, useState } from 'react'
import { Pressable, Text } from 'react-native'
import { matchBook, type BookContact } from '../contactBook'
import type { ContactsState } from '../app/screens'
import { Button } from './controls'
import { ConfirmDialog } from './ConfirmDialog'
import { FormInput, FormScroll } from './FormScroll'
import { Header } from './Header'
import { useStyles } from './useStyles'

/** What is being edited: one of the contacts, a new one, or none, which is the list. */
type Editing = BookContact | 'new' | null

/** The contacts the user keeps: a list to look through, a form to add or change one, and a vCard file in and out. */
export function ContactsScreen(props: {
  state: ContactsState
  onSave: (id: string | null, fields: { name: string; address: string }) => void
  onRemove: (id: string) => void
  onImport: () => void
  /** Writes one contact, or all of them, to a vCard file. */
  onExport: (id?: string) => void
  onBack: () => void
}) {
  const styles = useStyles()
  const { contacts, notice, error } = props.state
  const [looking, setLooking] = useState('')
  const [editing, setEditing] = useState<Editing>(null)
  const [fields, setFields] = useState({ name: '', address: '' })
  const [removing, setRemoving] = useState(false)
  const shown = useMemo(() => matchBook(contacts, looking), [contacts, looking])
  // What was done is said above the list, which is where the screen goes back to; a refusal leaves the form as it was typed.
  useEffect(() => {
    if (notice) setEditing(null)
  }, [notice, contacts])
  const open = (next: Editing) => {
    setEditing(next)
    setFields(next === null || next === 'new' ? { name: '', address: '' } : { name: next.name, address: next.address })
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
        <Header title="Kontakte" back={{ label: 'Einstellungen', onPress: props.onBack }} />
        {status}
        <Text style={styles.hint}>Die Personen, die du selbst behältst. Sie werden beim Tippen einer Adresse vorgeschlagen.</Text>
        <Button label="Kontakt hinzufügen" onPress={() => open('new')} />
        <Button label="vCard-Datei einlesen" variant="secondary" onPress={props.onImport} />
        {contacts.length > 0 ? <Button label="Alle als vCard speichern" variant="secondary" onPress={() => props.onExport()} /> : null}
        {contacts.length > 0 ? <FormInput placeholder="In den Kontakten suchen" autoCapitalize="none" autoCorrect={false} value={looking} onChangeText={setLooking} /> : null}
        {contacts.length === 0 ? <Text style={styles.hint}>Noch keine Kontakte.</Text> : null}
        {contacts.length > 0 && shown.length === 0 ? <Text style={styles.hint}>Nichts gefunden.</Text> : null}
        {shown.map((contact) => (
          <Pressable
            key={contact.id}
            accessibilityRole="button"
            style={styles.attachment}
            onPress={() => open(contact)}
          >
            <Text style={styles.itemTitle}>{contact.name || contact.address}</Text>
            {contact.name ? <Text style={styles.itemMeta}>{contact.address}</Text> : null}
          </Pressable>
        ))}
      </FormScroll>
    )
  }

  const current = editing === 'new' ? null : editing
  return (
    <FormScroll>
      <Header title={current ? 'Kontakt' : 'Neuer Kontakt'} back={{ label: 'Kontakte', onPress: () => setEditing(null) }} />
      {status}
      <FormInput placeholder="Name" value={fields.name} onChangeText={(name) => setFields((now) => ({ ...now, name }))} />
      <FormInput
        placeholder="E-Mail-Adresse"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={fields.address}
        onChangeText={(address) => setFields((now) => ({ ...now, address }))}
      />
      <Button
        label="Speichern"
        disabled={fields.address.trim() === ''}
        onPress={() => props.onSave(current?.id ?? null, fields)}
      />
      {current ? <Button label="Als vCard speichern" variant="secondary" onPress={() => props.onExport(current.id)} /> : null}
      {current ? <Button label="Kontakt entfernen" variant="danger" onPress={() => setRemoving(true)} /> : null}
      <ConfirmDialog
        visible={removing}
        title="Kontakt entfernen?"
        text="Der Kontakt wird von diesem Telefon entfernt. Nachrichten von und an ihn bleiben, wie sie sind."
        answers={[
          { label: 'Abbrechen', onPress: () => setRemoving(false) },
          {
            label: 'Kontakt entfernen',
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
