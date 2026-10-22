import { describe, expect, it } from 'vitest'
import { folderLabel } from './folderLabel'

const folder = (imapPath: string, specialUse: string | null = null, displayName = imapPath) => ({
  imapPath,
  displayName,
  specialUse
})

describe('the name of a folder on a screen', () => {
  it('is German for a folder that has a job', () => {
    expect(folderLabel(folder('Sent Items', '\\Sent'))).toBe('Gesendet')
    expect(folderLabel(folder('Deleted', '\\Trash'))).toBe('Papierkorb')
    expect(folderLabel(folder('Entwurf', '\\Drafts'))).toBe('Entwürfe')
    expect(folderLabel(folder('Spam', '\\Junk'))).toBe('Spam')
    expect(folderLabel(folder('Old', '\\Archive'))).toBe('Archiv')
  })

  it('takes the inbox by its name when the server named no role, in whatever case', () => {
    expect(folderLabel(folder('INBOX'))).toBe('Posteingang')
    expect(folderLabel(folder('Inbox'))).toBe('Posteingang')
  })

  it('keeps the name of any other folder, and of a role that is not known', () => {
    expect(folderLabel(folder('Projects/Phone', null, 'Phone'))).toBe('Phone')
    expect(folderLabel(folder('Odd', '\\Unheard', 'Odd'))).toBe('Odd')
  })

  it('does not take a folder for the inbox because its name ends with that of one', () => {
    expect(folderLabel(folder('Archive/INBOX', null, 'INBOX'))).toBe('INBOX')
  })
})
