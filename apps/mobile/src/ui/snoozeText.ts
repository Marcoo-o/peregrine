import { snoozeChoices, type SnoozePreset } from '@peregrine/core/snooze'

/** What the presets are called, as the desktop calls them. */
const PRESET_LABELS: Record<SnoozePreset, string> = {
  laterToday: 'Heute später',
  thisEvening: 'Heute Abend',
  tomorrow: 'Morgen früh',
  weekend: 'Am Wochenende',
  nextWeek: 'Nächste Woche'
}

/** A moment as a line says it: the day of the week, the day and the time. */
export function momentText(ms: number): string {
  return new Date(ms).toLocaleString('de-DE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** The moment a message that is put aside comes back, as the line under it in the list of those says it. */
export const backAtText = (ms: number): string => `Zurück am ${momentText(ms)}`

export interface SnoozeOption {
  preset: SnoozePreset
  label: string
  /** When it would come back, in epoch milliseconds. */
  until: number
  /** The same, as it is read. */
  when: string
}

/**
 * What can be chosen to put a message aside until, from now: the desktop's presets that are worth offering at this hour,
 * in the order of their time, without two that come to the same moment.
 */
export function snoozeOptions(now: Date): SnoozeOption[] {
  return snoozeChoices(now).map(({ preset, at }) => ({
    preset,
    label: PRESET_LABELS[preset],
    until: at.getTime(),
    when: momentText(at.getTime())
  }))
}
