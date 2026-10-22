import { describe, expect, it } from 'vitest'
import type { Account } from '../accounts'
import type { Screen } from '../app/screens'
import type { Folder } from '../folders'
import { locationOf, showsDrawer } from './drawer'
import { folderIconName, roleIconName } from './folderIcon'
import { roleLabel } from './folderLabel'

const folder = { id: 'f1' } as Folder
const account = { id: 'a1' } as Account

describe('where the sidebar says that the user is', () => {
  it('is the role, for a list of all accounts', () => {
    expect(locationOf({ name: 'unified', role: 'sent', messages: [], showPreview: true, busy: false, problems: [] } as Screen)).toEqual({ role: 'sent' })
  })

  it('is the folder, for the messages of a folder, and for a message that was opened from it', () => {
    const state = { name: 'messages', account, folder, messages: [], showPreview: true, folderNames: {}, busy: false } as Screen
    expect(locationOf(state)).toEqual({ folderId: 'f1' })
  })

  it('is nowhere for any other screen', () => {
    expect(locationOf({ name: 'accounts', accounts: [] })).toEqual({})
    expect(locationOf({ name: 'login' })).toEqual({})
  })
})

describe('the screens that the sidebar can be pulled out on', () => {
  it('are the lists and the places that lead to them, and not a message, a form or a choice', () => {
    for (const name of ['unified', 'messages', 'folders', 'accounts', 'search'] as const) expect(showsDrawer(name)).toBe(true)
    for (const name of ['message', 'compose', 'login', 'move', 'settings', 'loading'] as const) expect(showsDrawer(name)).toBe(false)
  })
})

describe('the names and pictures of the roles', () => {
  it('are the same as those of the folders that have them', () => {
    expect(roleLabel('inbox')).toBe('Posteingang')
    expect(roleLabel('drafts')).toBe('Entwürfe')
    expect(roleLabel('sent')).toBe('Gesendet')
    expect(roleLabel('archive')).toBe('Archiv')
    expect(roleLabel('junk')).toBe('Spam')
    expect(roleLabel('trash')).toBe('Papierkorb')
    expect(roleIconName('sent')).toBe(folderIconName({ specialUse: '\\Sent', imapPath: 'x' }))
    expect(roleIconName('inbox')).toBe('inbox')
    expect(roleIconName('trash')).toBe('trash')
  })
})
