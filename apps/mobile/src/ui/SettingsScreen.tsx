import { useState } from 'react'
import { Text, View } from 'react-native'
import type { SettingsState } from '../app/screens'
import { hasQuietHours, INTERVAL_CHOICES, UNDO_CHOICES } from '../settings'
import { Button, Chip, SwitchRow } from './controls'
import { FormInput, FormScroll } from './FormScroll'
import { Header } from './Header'
import { intervalLabel } from './intervalLabel'
import { useStyles } from './useStyles'
import { useTheme } from './useTheme'

type QuietEnd = 'quietFrom' | 'quietTo'

/** One end of the quiet hours. It is taken when the user is done typing, and only if it is a time of day. */
function TimeField(props: { label: string; value: string; onDone: (value: string) => void }) {
  const styles = useStyles()
  const [typed, setTyped] = useState(props.value)
  return (
    <View style={styles.setting}>
      <Text style={styles.settingLabel}>{props.label}</Text>
      <FormInput
        style={styles.timeInput}
        value={typed}
        placeholder="HH:MM"
        keyboardType="numbers-and-punctuation"
        onChangeText={setTyped}
        onEndEditing={() => props.onDone(typed)}
      />
    </View>
  )
}

export function SettingsScreen(props: {
  state: SettingsState
  onBack: () => void
  onEnabled: (enabled: boolean) => void
  onPreview: (preview: boolean) => void
  onShowPreview: (show: boolean) => void
  onDeviceContacts: (on: boolean) => void
  onUndoSeconds: (seconds: number) => void
  onTags: () => void
  onKeys: () => void
  onQuietHours: (on: boolean) => void
  onQuietTime: (end: QuietEnd, value: string) => void
  onMuted: (accountId: string) => void
  onInterval: (minutes: number) => void
  onRunNow: () => void
  onKeepConnection: (on: boolean) => void
  onBatterySettings: () => void
}) {
  const styles = useStyles()
  const { settings, list, sending, contactsPermitted, accounts, permitted, push, notice } = props.state
  const quiet = hasQuietHours(settings)
  const off = !settings.enabled

  return (
    <FormScroll>
      <Header title="Einstellungen" back={{ label: 'Konten', onPress: props.onBack }} />

      <Text style={styles.section}>Listen</Text>
      <View style={styles.group}>
        <SwitchRow label="Text unter dem Betreff zeigen" value={list.showPreview} onChange={props.onShowPreview} />
      </View>
      <Button label="Tags verwalten" variant="secondary" onPress={props.onTags} />

      <Text style={styles.section}>Senden, Rückgängig möglich für</Text>
      <View style={styles.actions}>
        {UNDO_CHOICES.map((seconds) => (
          <Chip
            key={seconds}
            label={seconds === 0 ? 'Aus' : `${seconds} Sekunden`}
            active={sending.undoSeconds === seconds}
            onPress={() => props.onUndoSeconds(seconds)}
          />
        ))}
      </View>
      <Text style={styles.hint}>
        Eine gesendete Nachricht wartet so lange, und bis dahin lässt sie sich zurücknehmen und weiterschreiben. Ist die Zeit um, geht sie ab.
      </Text>

      <Text style={styles.section}>Adressen</Text>
      <View style={styles.group}>
        <SwitchRow label="Kontakte des Geräts vorschlagen" value={list.deviceContacts} onChange={props.onDeviceContacts} />
      </View>
      <Text style={styles.hint}>
        Beim Tippen einer Adresse schlägt Peregrine auch Personen aus dem Adressbuch des Geräts vor. Sie werden nur zum Vorschlagen gelesen
        und nirgends gespeichert.
      </Text>
      {list.deviceContacts && !contactsPermitted ? (
        <Text style={styles.error}>Das System lässt das Lesen der Kontakte nicht zu. Das lässt sich in den Systemeinstellungen ändern.</Text>
      ) : null}

      <Text style={styles.section}>Verschlüsselung</Text>
      <Button label="Schlüssel verwalten" variant="secondary" onPress={props.onKeys} />

      <Text style={styles.section}>Benachrichtigungen</Text>
      <View style={styles.group}>
        <SwitchRow label="Neue Nachrichten melden" value={settings.enabled} onChange={props.onEnabled} />
        <SwitchRow label="Absender und Betreff zeigen" value={settings.preview} disabled={off} onChange={props.onPreview} />
        <SwitchRow label="Ruhezeiten" value={quiet} disabled={off} onChange={props.onQuietHours} />
        {quiet ? (
          <>
            <TimeField label="Von" value={settings.quietFrom} onDone={(value) => props.onQuietTime('quietFrom', value)} />
            <TimeField label="Bis" value={settings.quietTo} onDone={(value) => props.onQuietTime('quietTo', value)} />
          </>
        ) : null}
      </View>
      {settings.enabled && !permitted ? (
        <Text style={styles.error}>
          Das System lässt keine Benachrichtigungen von Peregrine zu. Das lässt sich in den Systemeinstellungen ändern.
        </Text>
      ) : null}
      {notice ? <Text style={styles.hint}>{notice}</Text> : null}

      {/* Where the system tells the phone of new mail itself there is nothing to switch: it is there. */}
      {push.system ? null : (
        <>
          <Text style={styles.section}>Sofort benachrichtigen</Text>
          <View style={styles.group}>
            <SwitchRow label="Verbindung offen halten" value={push.keepConnection} disabled={off} onChange={props.onKeepConnection} />
          </View>
          <Text style={styles.hint}>
            Peregrine hält die Verbindung zum Mailserver selbst offen und meldet neue Nachrichten sofort, statt im Abstand von Minuten
            oder Stunden. Solange das an ist, zeigt Android eine dauerhafte Benachrichtigung, und der Akku wird etwas stärker beansprucht.
            Damit die Verbindung auch hält, wenn das Telefon ruht, Peregrine von der Akkuoptimierung ausnehmen.
          </Text>
          {push.keepConnection ? <Button label="Akkuoptimierung öffnen" variant="secondary" onPress={props.onBatterySettings} /> : null}
        </>
      )}

      <Text style={styles.section}>Abruf im Hintergrund, alle</Text>
      <View style={styles.actions}>
        {INTERVAL_CHOICES.map((minutes) => (
          <Chip
            key={minutes}
            label={intervalLabel(minutes)}
            active={settings.intervalMinutes === minutes}
            onPress={() => props.onInterval(minutes)}
          />
        ))}
      </View>
      <Text style={styles.hint}>
        Das System ruft frühestens alle 15 Minuten ab und später, wenn das Telefon ruhig liegt oder der Akku schwach ist.
      </Text>
      <Button label="Jetzt abrufen" variant="secondary" disabled={off} onPress={props.onRunNow} />

      <Text style={styles.section}>Konten, die melden</Text>
      <View style={styles.group}>
        {accounts.map((account) => (
          <SwitchRow
            key={account.id}
            label={account.displayName}
            value={!settings.mutedAccountIds.includes(account.id)}
            disabled={off}
            onChange={() => props.onMuted(account.id)}
          />
        ))}
      </View>
    </FormScroll>
  )
}
