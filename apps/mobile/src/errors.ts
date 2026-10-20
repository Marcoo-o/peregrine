/** What went wrong, as a line for the screen: the message of an error, or whatever else was thrown. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
