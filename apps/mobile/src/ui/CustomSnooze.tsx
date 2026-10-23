import { useMemo, useState } from 'react'
import { ScrollView, Text, TextInput } from 'react-native'
import { Button, Chip } from './controls'
import { momentText } from './snoozeText'
import { CUSTOM_REASONS, customMoment, defaultMoment, snoozeDays } from './snoozeCustom'
import { useStyles } from './useStyles'
import { useTheme } from './useTheme'

/**
 * A moment of one's own to put a message aside until: a day of the next two weeks and a time of day, for what the presets
 * do not come to. What is chosen is said in words as it is typed, and the button is there when it is a moment ahead.
 * Read when it is opened, so that "today" is the day it is opened.
 */
export function CustomSnooze(props: { onChoose: (until: number) => void }) {
  const styles = useStyles()
  const { colors } = useTheme()
  const opened = useMemo(() => new Date(), [])
  const days = useMemo(() => snoozeDays(opened), [opened])
  const first = useMemo(() => defaultMoment(opened), [opened])
  const [dayIndex, setDayIndex] = useState(first.dayIndex)
  const [time, setTime] = useState(first.time)
  // Judged against the clock of now and not of when the sheet was opened: a minute may have passed since.
  const moment = customMoment(days[dayIndex].start, time, new Date())
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        {days.map((day, index) => (
          <Chip key={day.start.getTime()} label={day.label} active={index === dayIndex} onPress={() => setDayIndex(index)} />
        ))}
      </ScrollView>
      <TextInput
        accessibilityLabel="Uhrzeit"
        style={styles.input}
        placeholder="Uhrzeit, zum Beispiel 8:30"
        placeholderTextColor={colors.muted}
        value={time}
        onChangeText={setTime}
        keyboardType="numbers-and-punctuation"
        maxLength={5}
      />
      <Text style={styles.hint}>{moment.ok ? `Zurück am ${momentText(moment.until)}` : CUSTOM_REASONS[moment.reason]}</Text>
      <Button label="Erinnern" disabled={!moment.ok} onPress={() => moment.ok && props.onChoose(moment.until)} />
    </>
  )
}
