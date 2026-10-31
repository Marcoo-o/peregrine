import { t } from '../i18n'
/** How an interval in minutes is written on a button: minutes below an hour, hours from there. */
export function intervalLabel(minutes: number): string {
  if (minutes < 60) return t('{minutes} Min.', { minutes })
  const hours = minutes / 60
  return Number.isInteger(hours) ? t('{hours} Std.', { hours }) : t('{minutes} Min.', { minutes })
}
