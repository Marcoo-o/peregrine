import { FlatList, Pressable, Text, View } from 'react-native'
import type { Account } from '../accounts'
import type { AccountsState } from '../app/screens'
import { Button } from './controls'
import { styles } from './styles'

export function AccountsScreen(props: {
  state: AccountsState
  onOpen: (account: Account) => void
  onAdd: () => void
  onUnified: () => void
  onSettings: () => void
}) {
  const { accounts, error } = props.state
  return (
    <View style={styles.fill}>
      <Text style={styles.title}>Konten</Text>
      {accounts.length >= 2 ? <Button label="Alle Posteingänge" onPress={props.onUnified} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={accounts}
        keyExtractor={(account) => account.id}
        renderItem={({ item }) => (
          <Pressable style={styles.item} onPress={() => props.onOpen(item)}>
            <Text style={styles.itemTitle}>{item.displayName}</Text>
            <Text style={styles.itemMeta}>{item.emailAddress || item.imapHost}</Text>
          </Pressable>
        )}
      />
      <Button label="Konto hinzufügen" onPress={props.onAdd} />
      <Button label="Einstellungen" onPress={props.onSettings} />
    </View>
  )
}
