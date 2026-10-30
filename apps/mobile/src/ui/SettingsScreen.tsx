import { useState } from 'react'
import { Text, View } from 'react-native'
import type { SettingsState } from '../app/screens'
import { delayLabel, LOCK_DELAYS } from '../lock'
import { hasQuietHours, INTERVAL_CHOICES, UNDO_CHOICES } from '../settings'
import { APPEARANCE_CHOICES, appearance, type AppearanceMode } from '../appearance'
import type { SafetySettings } from '../safety'
import { useSafety } from './safety'
import { useSort } from './sort'
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
  onSafety: (change: Partial<SafetySettings>) => void
  onAppearance: (mode: AppearanceMode) => void
  onLock: (on: boolean) => void
  onConversations: (on: boolean) => void
  onLockDelay: (seconds: number) => void
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
  const { settings, list, sending, lock, lockAvailable, contactsPermitted, accounts, permitted, push, notice } = props.state
  const safety = useSafety()
  const { conversations } = useSort()
  const quiet = hasQuietHours(settings)
  const off = !settings.enabled

  return (
    <FormScroll>
      <Header title="Einstellungen" back={{ label: 'Konten', onPress: props.onBack }} />

      <Text style={styles.section}>App-Sperre</Text>
      <View style={styles.group}>
        <SwitchRow
          label="Mit der Bildschirmsperre sperren"
          hint={lockAvailable ? 'Die App zeigt keine Nachrichten, bis die Bildschirmsperre des Telefons eingegeben ist, und bleibt aus Bildschirmfotos und der Liste der letzten Apps heraus.' : 'Dieses Telefon hat keine Bildschirmsperre. Richte in den Systemeinstellungen eine ein.'}
          value={lock.enabled}
          disabled={!lockAvailable && !lock.enabled}
          onChange={props.onLock}
        />
      </View>
      {lock.enabled ? (
        <>
          <Text style={styles.section}>Wieder fragen nach</Text>
          <View style={styles.actions}>
            {LOCK_DELAYS.map((seconds) => (
              <Chip key={seconds} label={delayLabel(seconds)} active={lock.afterSeconds === seconds} onPress={() => props.onLockDelay(seconds)} />
            ))}
          </View>
        </>
      ) : null}

      <Text style={styles.section}>Erscheinungsbild</Text>
      <View style={styles.actions}>
        {APPEARANCE_CHOICES.map((choice) => (
          <Chip key={choice.mode} label={choice.label} active={appearance.mode === choice.mode} onPress={() => props.onAppearance(choice.mode)} />
        ))}
      </View>

      <Text style={styles.section}>Listen</Text>
      <View style={styles.group}>
        <SwitchRow
          label="Antworten zu Konversationen zusammenfassen"
          hint="Eine Zeile für alles, was zusammengehört, mit der neuesten Nachricht und der Zahl der Nachrichten."
          value={conversations}
          onChange={props.onConversations}
        />
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

      <Text style={styles.section}>Sicherheit beim Lesen</Text>
      <View style={styles.group}>
        <SwitchRow
          label="Vor verdächtigen Links warnen"
          hint="Ein Link, der nach einer anderen Adresse aussieht, als er führt, wird erst nach einer Rückfrage geöffnet."
          value={safety.warnSuspiciousLinks}
          onChange={(warnSuspiciousLinks) => props.onSafety({ warnSuspiciousLinks })}
        />
        <SwitchRow
          label="Vor jedem Link fragen"
          hint="Auch die Links, an denen nichts auffällt."
          value={safety.confirmAllLinks}
          onChange={(confirmAllLinks) => props.onSafety({ confirmAllLinks })}
        />
        <SwitchRow
          label="Vor riskanten Anhängen warnen"
          hint="Ein Anhang, der ein Programm starten würde oder nicht ist, was sein Name sagt, wird nicht an eine andere App weitergegeben."
          value={safety.warnRiskyAttachments}
          onChange={(warnRiskyAttachments) => props.onSafety({ warnRiskyAttachments })}
        />
      </View>

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
