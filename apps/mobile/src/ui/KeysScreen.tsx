import { useState } from 'react'
import { Text, View } from 'react-native'
import type { KeysState } from '../app/screens'
import type { ContactKey, OwnKey } from '../pgp/keyStore'
import { fingerprintLines, healthTag } from '../pgp/keyText'
import type { KeyState } from '../pgp/pgpService'
import type { ScannedKey } from '../pgp/pgpService'
import { Button, Spinner, SwitchRow } from './controls'
import { ConfirmDialog } from './ConfirmDialog'
import { FormInput, FormScroll } from './FormScroll'
import { Header } from './Header'
import { useStyles } from './useStyles'

function dayOf(ms: number | Date): string {
  return new Date(ms).toLocaleDateString('de-DE', { dateStyle: 'medium' })
}

/** The fingerprint of a key in two lines, which is what its owner reads out to anybody who wants to be sure of it. */
function Fingerprint(props: { value: string }) {
  const styles = useStyles()
  return (
    <>
      <Text style={styles.fieldLabel}>Fingerabdruck</Text>
      <Text selectable style={styles.fingerprint}>
        {fingerprintLines(props.value)}
      </Text>
    </>
  )
}

/** What is said of a key that is not in order, as a tag; nothing for one that is. */
function HealthTag(props: { state: KeyState | undefined }) {
  const styles = useStyles()
  const tag = props.state ? healthTag(props.state) : null
  if (!tag) return null
  return (
    <View style={tag.tone === 'danger' ? styles.tagDanger : styles.tagWarning}>
      <Text style={tag.tone === 'danger' ? styles.tagDangerText : styles.tagWarningText}>{tag.text}</Text>
    </View>
  )
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
    <View style={[styles.group, styles.keyCard]}>
      <Text style={styles.itemTitle}>{key.userIds[0] ?? 'Schlüssel ohne Namen'}</Text>
      {key.foundBy ? <Text style={styles.itemMeta}>{key.foundBy}</Text> : null}
      <View style={styles.actions}>
        <View style={styles.tag}>
          <Text style={styles.tagText}>{key.privateKey ? 'Mit privatem Teil' : 'Nur öffentlicher Teil'}</Text>
        </View>
        {expired ? (
          <View style={styles.tagWarning}>
            <Text style={styles.tagWarningText}>Abgelaufen am {dayOf(key.expiresAt as Date)}</Text>
          </View>
        ) : null}
      </View>
      <Fingerprint value={key.fingerprint} />
      <View style={{ height: 12 }} />
      {key.privateKey ? (
        <>
          {key.locked ? (
            <>
              <FormInput
                placeholder="Passwort des Schlüssels"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                value={passphrase}
                onChangeText={setPassphrase}
              />
              <Text style={styles.hint}>Das Öffnen eines geschützten Schlüssels dauert einige Sekunden und geschieht nur einmal.</Text>
            </>
          ) : null}
          {accounts.map((account) => (
            <Button
              key={account.id}
              label={`Für ${account.emailAddress || account.displayName} verwenden`}
              variant={matching.length > 0 ? 'primary' : 'secondary'}
              onPress={() => props.onAdoptOwn(account.id, passphrase)}
            />
          ))}
        </>
      ) : key.addresses.length > 0 ? (
        key.addresses.map((address) => <Button key={address} label={`Für ${address} merken`} onPress={() => props.onAdoptContact(address)} />)
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
  onSearch: (address: string) => void
  onAdoptOwn: (fingerprint: string, accountId: string, passphrase: string) => void
  onAdoptContact: (fingerprint: string, address: string) => void
  onDismiss: (fingerprint: string) => void
  onRemoveOwn: (accountId: string, fingerprint: string) => void
  onRemoveContact: (fingerprint: string) => void
  onExport: (accountId: string, fingerprint: string) => void
  /** Publishes the public key on the keyserver. */
  onPublish: (accountId: string, fingerprint: string) => void
  onDefault: (which: 'sign' | 'encrypt', on: boolean) => void
}) {
  const styles = useStyles()
  const { accounts, own, contacts, states, defaults, found, working, notice, error } = props.state
  const [pasted, setPasted] = useState('')
  const [searched, setSearched] = useState('')
  const [removing, setRemoving] = useState<{ title: string; text: string; remove: () => void } | null>(null)
  const [publishing, setPublishing] = useState<{ accountId: string; fingerprint: string; address: string } | null>(null)
  const idle = working === undefined

  const askToRemoveOwn = (account: KeysState['accounts'][number], key: OwnKey) =>
    setRemoving({
      title: 'Schlüssel entfernen?',
      text: `Nachrichten, die mit diesem Schlüssel für ${account.emailAddress} verschlüsselt wurden, lassen sich auf diesem Handy danach nicht mehr öffnen, wenn du den Schlüssel nicht noch anderswo hast.`,
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
        Mit OpenPGP verschlüsselst und signierst du Nachrichten. Verschlüsseln kannst du an alle, deren öffentlichen Schlüssel du hast.
        Lesen können das nur sie, mit ihrem privaten Schlüssel.
      </Text>
      {working ? (
        <>
          <Spinner />
          <Text style={styles.hint}>{working}</Text>
        </>
      ) : null}
      {notice ? <Text style={styles.hint}>{notice}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.section}>Beim Schreiben</Text>
      <View style={styles.group}>
        <SwitchRow
          label="Immer signieren"
          hint="Jede neue Nachricht beginnt signiert. Das gilt für Konten mit einem Schlüssel."
          value={defaults.sign}
          onChange={(on) => props.onDefault('sign', on)}
        />
        <SwitchRow
          label="Immer verschlüsseln"
          hint="Jede neue Nachricht beginnt verschlüsselt. Ohne Schlüssel des Empfängers lässt sie sich nicht senden, dann schaltest du es für diese Nachricht aus."
          value={defaults.encrypt}
          onChange={(on) => props.onDefault('encrypt', on)}
        />
      </View>

      <Text style={styles.section}>Deine Schlüssel</Text>
      {accounts.length === 0 ? <Text style={styles.hint}>Es gibt noch kein Konto.</Text> : null}
      {accounts.map((account) => (
        <View key={account.id}>
          {(own[account.id] ?? []).map((key, index) => (
            <View key={key.fingerprint} style={[styles.group, styles.keyCard]}>
              <Text style={styles.itemTitle}>{account.emailAddress || account.displayName}</Text>
              <Text style={styles.itemMeta}>Angelegt am {dayOf(key.createdAt)}</Text>
              <View style={styles.actions}>
                {index === 0 ? (
                  <View style={styles.tag}>
                    <Text style={styles.tagText}>Signiert damit</Text>
                  </View>
                ) : null}
                <HealthTag state={states[key.fingerprint]} />
              </View>
              <Fingerprint value={key.fingerprint} />
              <View style={{ height: 12 }} />
              <Button label="Öffentlichen Teil speichern" variant="secondary" disabled={!idle} onPress={() => props.onExport(account.id, key.fingerprint)} />
              <Button label="Auf keys.openpgp.org veröffentlichen" variant="secondary" disabled={!idle || !account.emailAddress} onPress={() => setPublishing({ accountId: account.id, fingerprint: key.fingerprint, address: account.emailAddress })} />
              <Button label="Entfernen" variant="danger" disabled={!idle} onPress={() => askToRemoveOwn(account, key)} />
            </View>
          ))}
          {(own[account.id] ?? []).length === 0 ? (
            <View style={[styles.group, styles.keyCard]}>
              <Text style={styles.itemTitle}>{account.emailAddress || account.displayName}</Text>
              <Text style={styles.itemMeta}>Für dieses Konto gibt es keinen Schlüssel.</Text>
              <View style={{ height: 12 }} />
              <Button label="Schlüssel auf dem Handy erzeugen" disabled={!idle} onPress={() => props.onGenerate(account.id)} />
            </View>
          ) : null}
        </View>
      ))}

      <Text style={styles.section}>Schlüssel von anderen</Text>
      {contacts.length === 0 ? <Text style={styles.hint}>Noch keine. Wer dir seinen öffentlichen Schlüssel gibt, dessen Schlüssel kannst du unten einlesen.</Text> : null}
      {contacts.map((key) => (
        <View key={key.fingerprint} style={[styles.group, styles.keyCard]}>
          <Text style={styles.itemTitle}>{key.address}</Text>
          <Text style={styles.itemMeta}>Gemerkt am {dayOf(key.createdAt)}</Text>
          <HealthTag state={states[key.fingerprint]} />
          <Fingerprint value={key.fingerprint} />
          <View style={{ height: 12 }} />
          <Button label="Entfernen" variant="danger" disabled={!idle} onPress={() => askToRemoveContact(key)} />
        </View>
      ))}

      <Text style={styles.section}>Schlüssel suchen</Text>
      <Text style={styles.hint}>
        Sucht den öffentlichen Schlüssel einer Adresse im Verzeichnis ihres Mailservers (WKD) und auf keys.openpgp.org. Die Suche
        verrät beiden, an wen du schreiben willst. Sie läuft nur, wenn du sie startest, und speichert nichts, bevor du es sagst.
      </Text>
      <FormInput
        placeholder="Adresse, zum Beispiel sam@example.net"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={searched}
        onChangeText={setSearched}
      />
      <Button
        label="Schlüssel suchen"
        variant="secondary"
        disabled={!idle || searched.trim() === ''}
        onPress={() => props.onSearch(searched)}
      />

      <Text style={styles.section}>Schlüssel einlesen</Text>
      <Text style={styles.hint}>
        Aus einer Datei (.asc, .gpg, .pgp oder .key) oder aus Text, den du hier einfügst. Ein privater Schlüssel kommt zu einem deiner
        Konten, ein öffentlicher zu der Adresse, für die er gilt.
      </Text>
      <Button label="Datei wählen" variant="secondary" disabled={!idle} onPress={props.onPickFile} />
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
        disabled={!idle || pasted.trim() === ''}
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
        visible={publishing !== null}
        title="Schlüssel veröffentlichen?"
        text={`Der öffentliche Schlüssel und die Adresse ${publishing?.address ?? ''} werden auf keys.openpgp.org abgelegt. Das lässt sich nicht zurücknehmen: die Adresse kann dort versteckt werden, der Schlüssel bleibt. Gefunden wird er erst, wenn du den Link in der Mail bestätigst, die der Server dir schickt.`}
        answers={[
          { label: 'Abbrechen', onPress: () => setPublishing(null) },
          {
            label: 'Veröffentlichen',
            variant: 'secondary',
            onPress: () => {
              if (publishing) props.onPublish(publishing.accountId, publishing.fingerprint)
              setPublishing(null)
            }
          }
        ]}
      />
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
