/**
 * When "remind me later" actually means.
 *
 * The presets are the whole feature: a date picker for something one wants gone in two
 * seconds defeats the purpose. Each of them is a small calendar question. "this evening"
 * after eight in the evening cannot mean today. Which is why they live here with tests
 * rather than inline in a menu handler.
 */

export type SnoozePreset = 'laterToday' | 'thisEvening' | 'tomorrow' | 'weekend' | 'nextWeek'

export const SNOOZE_PRESETS: SnoozePreset[] = [
  'laterToday',
  'thisEvening',
  'tomorrow',
  'weekend',
  'nextWeek'
]

/** The hours the presets aim for. */
const LATER_TODAY_HOURS = 3
const EVENING_HOUR = 18
const MORNING_HOUR = 8
const SATURDAY = 6
const MONDAY = 1

function atHour(from: Date, dayOffset: number, hour: number): Date {
  const result = new Date(from)
  result.setDate(result.getDate() + dayOffset)
  result.setHours(hour, 0, 0, 0)
  return result
}

/** Days ahead until the next given weekday; today counts as a full week away. */
function daysUntil(from: Date, weekday: number): number {
  const diff = (weekday - from.getDay() + 7) % 7
  return diff === 0 ? 7 : diff
}

/**
 * Resolves a preset against the current time.
 *
 * Every one of these can land in the past if taken literally. "this evening" at 23:00, "in
 * the morning" at 03:00. And a reminder in the past is one that fires immediately, which
 * reads as the feature being broken. So each preset moves on to the next occurrence instead.
 */
export function resolveSnoozePreset(preset: SnoozePreset, now: Date): Date {
  switch (preset) {
    case 'laterToday': {
      // The only relative one: three hours from now, rounded to the next full hour so the
      // reminder arrives at a time one can read off a clock.
      const result = new Date(now.getTime() + LATER_TODAY_HOURS * 3600_000)
      result.setMinutes(0, 0, 0)
      return result
    }
    case 'thisEvening': {
      const evening = atHour(now, 0, EVENING_HOUR)
      return evening > now ? evening : atHour(now, 1, EVENING_HOUR)
    }
    case 'tomorrow':
      return atHour(now, 1, MORNING_HOUR)
    case 'weekend': {
      // Saturday morning; asked for on a Saturday it means the one coming, not today.
      return atHour(now, daysUntil(now, SATURDAY), MORNING_HOUR)
    }
    case 'nextWeek':
      return atHour(now, daysUntil(now, MONDAY), MORNING_HOUR)
  }
}

/**
 * Whether a preset is worth offering right now.
 *
 * "This evening" at nine in the evening would mean tomorrow evening. Correct, but not what
 * the label says, and a menu that lies is worse than one entry shorter.
 */
export function isPresetUseful(preset: SnoozePreset, now: Date): boolean {
  if (preset === 'thisEvening') return now.getHours() < EVENING_HOUR
  if (preset === 'laterToday') return resolveSnoozePreset('laterToday', now).getDate() === now.getDate()
  if (preset === 'weekend') return now.getDay() !== SATURDAY && now.getDay() !== 0
  return true
}

export interface SnoozeChoice {
  preset: SnoozePreset
  at: Date
}

/**
 * The presets as they belong on screen: in time order, without repeats.
 *
 * Both corrections come from the same observation. The presets are labels for moments, and
 * two labels can name the same moment. On a Friday "tomorrow morning" and "at the weekend"
 * are both Saturday at eight, and offering the same time twice makes the user look for the
 * difference. Sorting is the other half: a list of times that does not run forwards has to
 * be read twice.
 */
export function snoozeChoices(now: Date): SnoozeChoice[] {
  const seen = new Set<number>()
  return SNOOZE_PRESETS.filter((preset) => isPresetUseful(preset, now))
    .map((preset) => ({ preset, at: resolveSnoozePreset(preset, now) }))
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .filter((choice) => {
      const key = choice.at.getTime()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

/** Reads the value of a datetime-local field as an epoch, rejecting anything in the past. */
export function parseCustomSnooze(value: string, now: Date): number | null {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.getTime() > now.getTime() ? parsed.getTime() : null
}
