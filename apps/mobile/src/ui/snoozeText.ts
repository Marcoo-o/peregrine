import { snoozeChoices, type SnoozePreset } from '@peregrine/core/snooze'
import { language, msg, t } from '../i18n'

/** What the presets are called, as the desktop calls them. */
const PRESET_LABELS: Record<SnoozePreset, string> = {
  laterToday: msg('Heute später'),
  thisEvening: msg('Heute Abend'),
  tomorrow: msg('Morgen früh'),
  weekend: msg('Am Wochenende'),
  nextWeek: msg('Nächste Woche')
}

/** A moment as a line says it: the day of the week, the day and the time. */
export function momentText(ms: number): string {
  return new Date(ms).toLocaleString(language.locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** The moment a message that is put aside comes back, as the line under it in the list of those says it. */
export const backAtText = (ms: number): string => t('Zurück am {n}', { n: momentText(ms) })

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
    label: t(PRESET_LABELS[preset]),
    until: at.getTime(),
    when: momentText(at.getTime())
  }))
}
