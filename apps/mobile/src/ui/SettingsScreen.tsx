import { useState } from 'react'
import { Switch, Text, View } from 'react-native'
import type { SettingsState } from '../app/screens'
import { hasQuietHours, INTERVAL_CHOICES } from '../settings'
import { BackLink, Button, Chip } from './controls'
import { FormInput, FormScroll } from './FormScroll'
import { intervalLabel } from './intervalLabel'
import { styles } from './styles'

type QuietEnd = 'quietFrom' | 'quietTo'

/** A line with a label and a switch, the shape most settings have. */
function SwitchRow(props: { label: string; value: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <View style={styles.setting}>
      <Text style={styles.settingLabel}>{props.label}</Text>
      <Switch value={props.value} disabled={props.disabled} onValueChange={props.onChange} />
    </View>
  )
}

/** One end of the quiet hours. It is taken when the user is done typing, and only if it is a time of day. */
function TimeField(props: { label: string; value: string; onDone: (value: string) => void }) {
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
  onQuietHours: (on: boolean) => void
  onQuietTime: (end: QuietEnd, value: string) => void
  onMuted: (accountId: string) => void
  onInterval: (minutes: number) => void
  onRunNow: () => void
}) {
  const { settings, accounts, permitted, notice } = props.state
  const quiet = hasQuietHours(settings)
  const off = !settings.enabled

  return (
    <FormScroll>
      <BackLink label="‹ Konten" onPress={props.onBack} />
      <Text style={styles.title}>Einstellungen</Text>

      <Text style={styles.section}>Benachrichtigungen</Text>
      <SwitchRow label="Neue Nachrichten melden" value={settings.enabled} onChange={props.onEnabled} />
      {settings.enabled && !permitted ? (
        <Text style={styles.error}>
          Das System lässt keine Benachrichtigungen von Peregrine zu. Das lässt sich in den Systemeinstellungen ändern.
        </Text>
      ) : null}
      {notice ? <Text style={styles.hint}>{notice}</Text> : null}
      <SwitchRow label="Absender und Betreff zeigen" value={settings.preview} disabled={off} onChange={props.onPreview} />
      <SwitchRow label="Ruhezeiten" value={quiet} disabled={off} onChange={props.onQuietHours} />
      {quiet ? (
        <>
          <TimeField label="Von" value={settings.quietFrom} onDone={(value) => props.onQuietTime('quietFrom', value)} />
          <TimeField label="Bis" value={settings.quietTo} onDone={(value) => props.onQuietTime('quietTo', value)} />
        </>
      ) : null}

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
      <Button label="Jetzt abrufen" disabled={off} onPress={props.onRunNow} />

      <Text style={styles.section}>Konten, die melden</Text>
      {accounts.map((account) => (
        <SwitchRow
          key={account.id}
          label={account.displayName}
          value={!settings.mutedAccountIds.includes(account.id)}
          disabled={off}
          onChange={() => props.onMuted(account.id)}
        />
      ))}
    </FormScroll>
  )
}
