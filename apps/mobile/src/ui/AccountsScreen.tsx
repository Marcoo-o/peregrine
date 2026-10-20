import { FlatList, Text, View } from 'react-native'
import type { Account } from '../accounts'
import type { AccountsState } from '../app/screens'
import { Button } from './controls'
import { Header } from './Header'
import { ListRow } from './ListRow'
import { useStyles } from './useStyles'

export function AccountsScreen(props: {
  state: AccountsState
  onOpen: (account: Account) => void
  onAdd: () => void
  onUnified: () => void
  onSettings: () => void
}) {
  const styles = useStyles()
  const { accounts, error } = props.state
  return (
    <View style={styles.fill}>
      <Header title="Konten" />
      {accounts.length >= 2 ? <Button label="Alle Posteingänge" onPress={props.onUnified} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={accounts}
        keyExtractor={(account) => account.id}
        renderItem={({ item }) => (
          <ListRow
            title={item.displayName}
            meta={item.emailAddress || item.imapHost}
            color={item.color}
            onPress={() => props.onOpen(item)}
          />
        )}
      />
      <Button label="Konto hinzufügen" variant="secondary" onPress={props.onAdd} />
      <Button label="Einstellungen" variant="secondary" onPress={props.onSettings} />
    </View>
  )
}
