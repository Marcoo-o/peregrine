import { t, tn } from '../i18n'
/** The line under a tag in the list of tags: its keyword on the server, and how many of the stored messages have it. */
export function tagMeta(keyword: string, count: number): string {
  if (count === 0) return t('{keyword}, keine Nachricht', { keyword })
  return tn(count, '{keyword}, {count} Nachricht', '{keyword}, {count} Nachrichten', { keyword })
}
