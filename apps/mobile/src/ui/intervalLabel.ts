/** How an interval in minutes is written on a button: minutes below an hour, hours from there. */
export function intervalLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} Min.`
  const hours = minutes / 60
  return Number.isInteger(hours) ? `${hours} Std.` : `${minutes} Min.`
}
