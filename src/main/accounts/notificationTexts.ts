/**
 * The few strings the main process puts on screen itself.
 *
 * Notifications are built by the operating system, not by the renderer, so i18next is not
 * available here. Rather than pull the whole translation machinery into the main process for
 * two sentences, the strings live in one small table. And the language setting decides, the
 * same one the renderer follows.
 */

export interface NotificationTexts {
  newMail: string
  /** Used when the preview is off, so the count is all that may be said. */
  newMailCount: (count: number) => string
  snoozeTitle: string
  snoozeCount: (count: number) => string
}

const TEXTS: Record<string, NotificationTexts> = {
  de: {
    newMail: 'Neue Nachricht',
    newMailCount: (count) => (count === 1 ? '1 neue Nachricht' : `${count} neue Nachrichten`),
    snoozeTitle: 'Wiedervorlage',
    snoozeCount: (count) => (count === 1 ? '1 Nachricht ist zurück' : `${count} Nachrichten sind zurück`)
  },
  en: {
    newMail: 'New message',
    newMailCount: (count) => (count === 1 ? '1 new message' : `${count} new messages`),
    snoozeTitle: 'Reminder',
    snoozeCount: (count) => (count === 1 ? '1 message is back' : `${count} messages are back`)
  },
  es: {
    newMail: 'Mensaje nuevo',
    newMailCount: (count) => (count === 1 ? '1 mensaje nuevo' : `${count} mensajes nuevos`),
    snoozeTitle: 'Recordatorio',
    snoozeCount: (count) =>
      count === 1 ? '1 mensaje ha vuelto' : `${count} mensajes han vuelto`
  },
  fr: {
    newMail: 'Nouveau message',
    newMailCount: (count) => (count === 1 ? '1 nouveau message' : `${count} nouveaux messages`),
    snoozeTitle: 'Rappel',
    snoozeCount: (count) =>
      count === 1 ? '1 message est de retour' : `${count} messages sont de retour`
  },
  pt: {
    newMail: 'Mensagem nova',
    newMailCount: (count) => (count === 1 ? '1 mensagem nova' : `${count} mensagens novas`),
    snoozeTitle: 'Lembrete',
    snoozeCount: (count) =>
      count === 1 ? '1 mensagem está de volta' : `${count} mensagens estão de volta`
  }
}

/**
 * `language` is the app setting and may be 'system' or a full tag such as 'de-AT'; the caller
 * passes the system locale for the first case. Anything unknown falls back to English.
 */
export function notificationTexts(language: string, systemLocale: string): NotificationTexts {
  const tag = language === 'system' ? systemLocale : language
  return TEXTS[tag.slice(0, 2).toLowerCase()] ?? TEXTS.en
}
