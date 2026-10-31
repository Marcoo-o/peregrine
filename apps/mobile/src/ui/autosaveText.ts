import type { AutosaveStatus } from '../app/screens'
import { language, t } from '../i18n'

/** The line the compose screen says about the draft that is kept by itself, as the desktop says it. */
export function autosaveText(status: AutosaveStatus): string {
  switch (status.status) {
    case 'saving':
      return t('Entwurf wird gespeichert …')
    case 'waiting':
      return t('Entwurf wartet auf eine Verbindung')
    case 'saved':
      return t('Entwurf gespeichert um {n}', { n: new Date(status.at).toLocaleTimeString(language.locale, { hour: '2-digit', minute: '2-digit' }) })
    case 'failed':
      return t('Entwurf konnte nicht gespeichert werden: {error}', { error: status.error })
  }
}
