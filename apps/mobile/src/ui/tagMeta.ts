/** The line under a tag in the list of tags: its keyword on the server, and how many of the stored messages have it. */
export function tagMeta(keyword: string, count: number): string {
  if (count === 0) return `${keyword} · keine Nachricht`
  return count === 1 ? `${keyword} · 1 Nachricht` : `${keyword} · ${count} Nachrichten`
}
