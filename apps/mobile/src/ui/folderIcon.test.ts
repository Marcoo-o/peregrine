import { describe, expect, it } from 'vitest'
import { folderIconName } from './folderIcon'

const folder = (imapPath: string, specialUse: string | null = null) => ({ imapPath, specialUse })

describe('the picture of a folder', () => {
  it('is that of its role', () => {
    expect(folderIconName(folder('Sent Items', '\\Sent'))).toBe('sent')
    expect(folderIconName(folder('Entwurf', '\\Drafts'))).toBe('drafts')
    expect(folderIconName(folder('Deleted', '\\Trash'))).toBe('trash')
    expect(folderIconName(folder('Spam', '\\Junk'))).toBe('junk')
    expect(folderIconName(folder('Old', '\\Archive'))).toBe('archive')
  })

  it('is the inbox for the folder called INBOX when the server named no role, in any case', () => {
    expect(folderIconName(folder('INBOX'))).toBe('inbox')
    expect(folderIconName(folder('Inbox'))).toBe('inbox')
  })

  it('is a folder for any other, and for a role that is not known', () => {
    expect(folderIconName(folder('Projects/Phone'))).toBe('folder')
    expect(folderIconName(folder('Odd', '\\Unheard'))).toBe('folder')
  })
})
