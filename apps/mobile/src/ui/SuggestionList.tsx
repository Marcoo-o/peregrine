import { Pressable, Text, View } from 'react-native'
import type { Contact } from '../contacts'
import { useStyles } from './useStyles'

/** The people that match what is being typed in a field, under it, to be put into it with a tap. */
export function SuggestionList(props: { contacts: Contact[]; onChoose: (contact: Contact) => void }) {
  const styles = useStyles()
  if (props.contacts.length === 0) return null
  return (
    <View style={styles.suggestions}>
      {props.contacts.map((contact) => (
        <Pressable
          key={contact.address}
          accessibilityRole="button"
          accessibilityLabel={contact.name ? `${contact.name}, ${contact.address}` : contact.address}
          style={styles.suggestion}
          onPress={() => props.onChoose(contact)}
        >
          {contact.name ? <Text style={styles.itemTitle}>{contact.name}</Text> : null}
          <Text style={contact.name ? styles.itemMeta : styles.itemTitle}>{contact.address}</Text>
        </Pressable>
      ))}
    </View>
  )
}
