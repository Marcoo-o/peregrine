import type { AttachmentFinding, OpeningRefusal } from '@peregrine/core/attachmentSafety'
import type { RefusedFile } from './draft'
import { MAX_ATTACHMENT_BYTES } from './files'
import { t } from './i18n'

/** A size as a person reads it: bytes, then kilobytes and megabytes with a decimal comma. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const decimal = (value: number): string => value.toFixed(1).replace('.', ',').replace(/,0$/, '')
  if (bytes < 1024 * 1024) return `${decimal(bytes / 1024)} KB`
  return `${decimal(bytes / (1024 * 1024))} MB`
}

/** What a finding about a file name says, in a sentence for the screen. */
export function riskText(finding: AttachmentFinding): string {
  switch (finding.risk) {
    case 'executable':
      return t('Ein Programm ({detail}): Öffnen würde es starten.', { detail: finding.detail })
    case 'doubleExtension':
      return t('Doppelte Endung {detail}: Es gilt die letzte.', { detail: finding.detail })
    case 'deceptiveName':
      return t('Der Name enthält unsichtbare Zeichen oder wechselt die Schreibrichtung.')
    case 'archive':
      return t('Ein Archiv ({detail}): Was darin ist, wurde nicht geprüft.', { detail: finding.detail })
  }
}

/** Why a file was not handed to another application, and what is left to do. */
export function refusalText(refusal: OpeningRefusal): string {
  return refusal === 'executable'
    ? t('Nicht geöffnet: Die Datei würde ein Programm starten. Speichern ist möglich, wenn du sie wirklich brauchst.')
    : t('Nicht geöffnet: Der Inhalt passt nicht zum Namen, wie bei einem getarnten Programm. Speichern ist möglich.')
}

/** Says which files were not attached, and why: nothing is left out in silence. */
export function refusedFilesText(refused: RefusedFile[]): string {
  const names = refused.map((file) => file.name).join(', ')
  return t('Nicht angehängt, weil es zu groß ist (insgesamt höchstens {n}): {names}', { n: formatSize(MAX_ATTACHMENT_BYTES), names })
}
