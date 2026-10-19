import type { AttachmentFinding, OpeningRefusal } from '@peregrine/core/attachmentSafety'

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
      return `Ein Programm (${finding.detail}): Öffnen würde es starten.`
    case 'doubleExtension':
      return `Doppelte Endung ${finding.detail}: Es gilt die letzte.`
    case 'deceptiveName':
      return 'Der Name enthält unsichtbare Zeichen oder wechselt die Schreibrichtung.'
    case 'archive':
      return `Ein Archiv (${finding.detail}): Was darin ist, wurde nicht geprüft.`
  }
}

/** Why a file was not handed to another application, and what is left to do. */
export function refusalText(refusal: OpeningRefusal): string {
  return refusal === 'executable'
    ? 'Nicht geöffnet: Die Datei würde ein Programm starten. Speichern ist möglich, wenn du sie wirklich brauchst.'
    : 'Nicht geöffnet: Der Inhalt passt nicht zum Namen, wie bei einem getarnten Programm. Speichern ist möglich.'
}
