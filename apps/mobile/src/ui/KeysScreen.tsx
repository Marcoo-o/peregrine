import { useState } from 'react'
import { Text, View } from 'react-native'
import type { KeysState } from '../app/screens'
import type { ContactKey, OwnKey } from '../pgp/keyStore'
import { groupedFingerprint, shortFingerprint } from '../pgp/keyText'
import type { ScannedKey } from '../pgp/pgpService'
import { Button, Spinner } from './controls'
import { ConfirmDialog } from './ConfirmDialog'
import { FormInput, FormScroll } from './FormScroll'
import { Header } from './Header'
import { useStyles } from './useStyles'

function createdOn(ms: number): string {
  return new Date(ms).toLocaleDateString('de-DE', { dateStyle: 'medium' })
}

/** A key that was read from a file or from text, and the ways it can be taken. */
function FoundKey(props: {
  scanned: ScannedKey
  accounts: KeysState['accounts']
  onAdoptOwn: (accountId: string, passphrase: string) => void
  onAdoptContact: (address: string) => void
  onDismiss: () => void
}) {
  const styles = useStyles()
  const [passphrase, setPassphrase] = useState('')
  const key = props.scanned
  const expired = key.expiresAt !== null && key.expiresAt.getTime() < Date.now()
  const matching = props.accounts.filter((account) => key.addresses.includes(account.emailAddress.toLowerCase()))
  const accounts = matching.length > 0 ? matching : props.accounts
  return (
    <View style={styles.group}>
      <Text style={styles.itemTitle}>{key.userIds[0] ?? 'Schlüssel ohne Namen'}</Text>
      <Text style={styles.itemMeta}>{shortFingerprint(key.fingerprint)}</Text>
      <Text style={styles.itemMeta}>
        {key.privateKey ? 'Mit privatem Teil' : 'Nur öffentlicher Teil'}
        {expired ? ' · abgelaufen' : ''}
      </Text>
      {key.privateKey ? (
        <>
          {key.locked ? (
            <FormInput
              placeholder="Passwort des Schlüssels"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              value={passphrase}
              onChangeText={setPassphrase}
            />
          ) : null}
          {accounts.map((account) => (
            <Button
              key={account.id}
              label={`Für ${account.emailAddress || account.displayName} verwenden`}
              variant={matching.length > 0 ? 'primary' : 'secondary'}
              onPress={() => props.onAdoptOwn(account.id, passphrase)}
            />
          ))}
          {key.locked ? (
            <Text style={styles.hint}>Das Öffnen eines geschützten Schlüssels dauert hier bis zu einer Minute. Es geschieht nur einmal.</Text>
          ) : null}
        </>
      ) : key.addresses.length > 0 ? (
        key.addresses.map((address) => (
          <Button key={address} label={`Für ${address} merken`} onPress={() => props.onAdoptContact(address)} />
        ))
      ) : (
        <Text style={styles.hint}>Der Schlüssel nennt keine Adresse, für die er gemerkt werden könnte.</Text>
      )}
      <Button label="Nicht übernehmen" variant="secondary" onPress={props.onDismiss} />
    </View>
  )
}

/** The OpenPGP keys: those of the accounts, those of the people written to, and the place to bring keys in. */
export function KeysScreen(props: {
  state: KeysState
  onBack: () => void
  onGenerate: (accountId: string) => void
  onPickFile: () => void
  onPasted: (text: string) => void
  onAdoptOwn: (fingerprint: string, accountId: string, passphrase: string) => void
  onAdoptContact: (fingerprint: string, address: string) => void
  onDismiss: (fingerprint: string) => void
  onRemoveOwn: (accountId: string, fingerprint: string) => void
  onRemoveContact: (fingerprint: string) => void
  onExport: (accountId: string, fingerprint: string) => void
}) {
  const styles = useStyles()
  const { accounts, own, contacts, found, working, notice, error } = props.state
  const [pasted, setPasted] = useState('')
  const [removing, setRemoving] = useState<{ title: string; text: string; remove: () => void } | null>(null)

  const askToRemoveOwn = (account: KeysState['accounts'][number], key: OwnKey) =>
    setRemoving({
      title: 'Schlüssel entfernen?',
      text: `Nachrichten, die mit diesem Schlüssel verschlüsselt wurden, lassen sich auf diesem Handy danach nicht mehr öffnen. Es sei denn, du hast den Schlüssel noch anderswo. (${account.emailAddress}, ${shortFingerprint(key.fingerprint)})`,
      remove: () => props.onRemoveOwn(account.id, key.fingerprint)
    })
  const askToRemoveContact = (key: ContactKey) =>
    setRemoving({
      title: `Schlüssel von ${key.address} entfernen?`,
      text: 'Danach lässt sich für diese Adresse nicht mehr verschlüsseln, und Signaturen von ihr werden nicht mehr geprüft.',
      remove: () => props.onRemoveContact(key.fingerprint)
    })

  return (
    <FormScroll>
      <Header title="Schlüssel" back={{ label: 'Einstellungen', onPress: props.onBack }} />
      <Text style={styles.hint}>
        Mit OpenPGP lassen sich Nachrichten verschlüsseln und signieren. Verschlüsseln kannst du an alle, deren öffentlichen
        Schlüssel du hast. Lesen können das nur sie, mit ihrem privaten Schlüssel.
      </Text>
      {working ? (
        <>
          <Spinner />
          <Text style={styles.hint}>{working}</Text>
        </>
      ) : null}
      {notice ? <Text style={styles.hint}>{notice}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.section}>Deine Schlüssel</Text>
      {accounts.length === 0 ? <Text style={styles.hint}>Es gibt noch kein Konto.</Text> : null}
      {accounts.map((account) => (
        <View key={account.id} style={styles.group}>
          <Text style={styles.itemTitle}>{account.emailAddress || account.displayName}</Text>
          {(own[account.id] ?? []).map((key, index) => (
            <View key={key.fingerprint}>
              <Text style={styles.itemMeta}>
                {shortFingerprint(key.fingerprint)} · angelegt {createdOn(key.createdAt)}
                {index === 0 ? ' · signiert damit' : ''}
              </Text>
              <Text selectable style={styles.itemMeta}>
                {groupedFingerprint(key.fingerprint)}
              </Text>
              <View style={styles.actions}>
                <Button label="Öffentlichen Teil speichern" variant="secondary" disabled={working !== undefined} onPress={() => props.onExport(account.id, key.fingerprint)} />
                <Button label="Entfernen" variant="danger" disabled={working !== undefined} onPress={() => askToRemoveOwn(account, key)} />
              </View>
            </View>
          ))}
          {(own[account.id] ?? []).length === 0 ? (
            <>
              <Text style={styles.hint}>Für dieses Konto gibt es keinen Schlüssel.</Text>
              <Button label="Schlüssel auf dem Handy erzeugen" disabled={working !== undefined} onPress={() => props.onGenerate(account.id)} />
            </>
          ) : null}
        </View>
      ))}

      <Text style={styles.section}>Schlüssel von anderen</Text>
      {contacts.length === 0 ? <Text style={styles.hint}>Noch keine. Wer dir seinen öffentlichen Schlüssel gibt, kann ihn hier eingelesen werden.</Text> : null}
      {contacts.map((key) => (
        <View key={key.fingerprint} style={styles.group}>
          <Text style={styles.itemTitle}>{key.address}</Text>
          <Text style={styles.itemMeta}>{shortFingerprint(key.fingerprint)} · gemerkt {createdOn(key.createdAt)}</Text>
          <Button label="Entfernen" variant="danger" disabled={working !== undefined} onPress={() => askToRemoveContact(key)} />
        </View>
      ))}

      <Text style={styles.section}>Schlüssel einlesen</Text>
      <Text style={styles.hint}>
        Aus einer Datei (.asc, .gpg, .pgp, .key) oder aus Text, den du hier einfügst. Ein privater Schlüssel kommt zu einem deiner
        Konten, ein öffentlicher zu der Adresse, für die er gilt.
      </Text>
      <Button label="Datei wählen" variant="secondary" disabled={working !== undefined} onPress={props.onPickFile} />
      <FormInput
        style={styles.multiline}
        placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----"
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        textAlignVertical="top"
        value={pasted}
        onChangeText={setPasted}
      />
      <Button
        label="Eingefügten Text einlesen"
        variant="secondary"
        disabled={working !== undefined || pasted.trim() === ''}
        onPress={() => {
          props.onPasted(pasted)
          setPasted('')
        }}
      />

      {found && found.length > 0 ? (
        <>
          <Text style={styles.section}>Gefunden</Text>
          {found.map((key) => (
            <FoundKey
              key={key.fingerprint}
              scanned={key}
              accounts={accounts}
              onAdoptOwn={(accountId, passphrase) => props.onAdoptOwn(key.fingerprint, accountId, passphrase)}
              onAdoptContact={(address) => props.onAdoptContact(key.fingerprint, address)}
              onDismiss={() => props.onDismiss(key.fingerprint)}
            />
          ))}
        </>
      ) : null}

      <ConfirmDialog
        visible={removing !== null}
        title={removing?.title ?? ''}
        text={removing?.text ?? ''}
        answers={[
          { label: 'Behalten', onPress: () => setRemoving(null) },
          {
            label: 'Entfernen',
            variant: 'danger',
            onPress: () => {
              removing?.remove()
              setRemoving(null)
            }
          }
        ]}
      />
    </FormScroll>
  )
}
