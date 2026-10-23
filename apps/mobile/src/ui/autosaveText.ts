import type { AutosaveStatus } from '../app/screens'

/** The line the compose screen says about the draft that is kept by itself, as the desktop says it. */
export function autosaveText(status: AutosaveStatus): string {
  switch (status.status) {
    case 'saving':
      return 'Entwurf wird gespeichert …'
    case 'waiting':
      return 'Entwurf wartet auf eine Verbindung'
    case 'saved':
      return `Entwurf gespeichert um ${new Date(status.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
    case 'failed':
      return `Entwurf konnte nicht gespeichert werden: ${status.error}`
  }
}
