import { FlatList, Text, View } from 'react-native'
import type { Account } from '../accounts'
import type { AccountsState } from '../app/screens'
import { Button } from './controls'
import { Title } from './Header'
import { ListRow } from './ListRow'
import { TopBar } from './TopBar'
import { useStyles } from './useStyles'
import { t } from '../i18n'

/** The line under the name of an account: its address, unless that is the name already, which is what an account is called by default. */
function addressLine(account: Account): string | undefined {
  const address = account.emailAddress || account.imapHost
  return address === account.displayName ? undefined : address
}

/**
 * The accounts, as a list to open one from. The ways to the lists of all of them, to the search and to the settings
 * are those of every list: the top bar and the sidebar.
 */
export function AccountsScreen(props: {
  state: AccountsState
  onOpen: (account: Account) => void
  onAdd: () => void
  onSearch: () => void
  onSettings: () => void
}) {
  const styles = useStyles()
  const { accounts, error } = props.state
  return (
    <View style={styles.fill}>
      <TopBar onSearch={props.onSearch} onSettings={props.onSettings} />
      <Title text={t('Konten')} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={accounts}
        keyExtractor={(account) => account.id}
        renderItem={({ item }) => (
          <ListRow
            title={item.displayName}
            meta={addressLine(item)}
            color={item.color}
            onPress={() => props.onOpen(item)}
          />
        )}
      />
      <Button label={t('Konto hinzufügen')} variant="secondary" onPress={props.onAdd} />
    </View>
  )
}
