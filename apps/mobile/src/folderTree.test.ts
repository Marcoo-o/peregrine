import { describe, expect, it } from 'vitest'
import type { Folder } from './folders'
import { buildFolderTree, visibleRows } from './folderTree'

let counter = 0
const folder = (imapPath: string, over: Partial<Folder> = {}): Folder => {
  const slash = imapPath.lastIndexOf('/')
  return {
    id: `f${++counter}`,
    accountId: 'a',
    imapPath,
    displayName: imapPath.slice(slash + 1),
    specialUse: null,
    parentPath: slash === -1 ? null : imapPath.slice(0, slash),
    ...over
  }
}

const shape = (nodes: ReturnType<typeof buildFolderTree>): unknown[] =>
  nodes.map((node) => (node.children.length > 0 ? [node.path, shape(node.children)] : node.path))

describe('the folders of an account as a tree', () => {
  it('puts a folder under the one it sits in, and the rest at the top', () => {
    const tree = buildFolderTree([folder('Projects'), folder('Projects/Phone'), folder('Projects/Desktop'), folder('Misc')])
    expect(shape(tree)).toEqual(['Misc', ['Projects', ['Projects/Desktop', 'Projects/Phone']]])
  })

  it('has the inbox first and then the folders with a role in the order they are used, then the others by name', () => {
    const tree = buildFolderTree([
      folder('Zebra'),
      folder('Trash', { specialUse: '\\Trash' }),
      folder('Alpha'),
      folder('Sent', { specialUse: '\\Sent' }),
      folder('INBOX'),
      folder('Junk', { specialUse: '\\Junk' }),
      folder('Drafts', { specialUse: '\\Drafts' }),
      folder('Archive', { specialUse: '\\Archive' })
    ])
    expect(tree.map((node) => node.path)).toEqual(['INBOX', 'Drafts', 'Sent', 'Archive', 'Junk', 'Trash', 'Alpha', 'Zebra'])
  })

  it('has the folders under a folder by name, whatever case they are written in', () => {
    const tree = buildFolderTree([folder('Misc'), folder('Misc/b'), folder('Misc/A'), folder('Misc/c')])
    expect(tree[0].children.map((node) => node.path)).toEqual(['Misc/A', 'Misc/b', 'Misc/c'])
  })

  it('is made up for a folder that cannot be chosen and that others sit in, as a name for them to be under', () => {
    // Some servers have a parent that is only a place for others, which is not kept as a folder for mail.
    const tree = buildFolderTree([folder('Archive/2025'), folder('Archive/2026')])
    expect(shape(tree)).toEqual([['Archive', ['Archive/2025', 'Archive/2026']]])
    expect(tree[0].folder).toBeNull()
    expect(tree[0].label).toBe('Archive')
  })

  it('is made up for as many levels as are missing', () => {
    const tree = buildFolderTree([folder('Work/Clients/Acme')])
    expect(shape(tree)).toEqual([['Work', [['Work/Clients', ['Work/Clients/Acme']]]]])
    expect(tree[0].children[0].label).toBe('Clients')
  })

  it('has every folder at the top when the server did not say where they sit', () => {
    const tree = buildFolderTree([folder('Projects/Phone', { parentPath: null }), folder('Misc', { parentPath: null })])
    expect(tree.map((node) => node.path)).toEqual(['Misc', 'Projects/Phone'])
  })

  it('works with a delimiter that is not a slash', () => {
    const tree = buildFolderTree([
      folder('Projects.Phone', { displayName: 'Phone', parentPath: 'Projects' }),
      folder('Projects.Desktop', { displayName: 'Desktop', parentPath: 'Projects' })
    ])
    expect(shape(tree)).toEqual([['Projects', ['Projects.Desktop', 'Projects.Phone']]])
  })

  it('is nothing for no folders', () => {
    expect(buildFolderTree([])).toEqual([])
  })
})

describe('the rows that are shown of the tree', () => {
  const folders = [folder('INBOX'), folder('Projects'), folder('Projects/Phone'), folder('Projects/Desktop')]
  const idOf = (path: string) => folders.find((candidate) => candidate.imapPath === path)!.id

  it('are each folder, with how deep it is, and whether it can be opened, closed or neither', () => {
    const rows = visibleRows(buildFolderTree(folders), new Set(), {})
    expect(rows.map((row) => [row.node.path, row.depth, row.expanded])).toEqual([
      ['INBOX', 0, null],
      ['Projects', 0, true],
      ['Projects/Desktop', 1, null],
      ['Projects/Phone', 1, null]
    ])
  })

  it('leave out what is under a folder that is closed', () => {
    const rows = visibleRows(buildFolderTree(folders), new Set(['Projects']), {})
    expect(rows.map((row) => [row.node.path, row.expanded])).toEqual([
      ['INBOX', null],
      ['Projects', false]
    ])
  })

  it('count the unread messages of a folder, and of all that are under it while it is closed', () => {
    const unread = { [idOf('Projects')]: 1, [idOf('Projects/Phone')]: 4, [idOf('Projects/Desktop')]: 2 }
    const open = visibleRows(buildFolderTree(folders), new Set(), unread)
    expect(open.map((row) => [row.node.path, row.count])).toEqual([
      ['INBOX', 0],
      ['Projects', 1],
      ['Projects/Desktop', 2],
      ['Projects/Phone', 4]
    ])
    const closed = visibleRows(buildFolderTree(folders), new Set(['Projects']), unread)
    expect(closed.find((row) => row.node.path === 'Projects')?.count).toBe(7)
  })

  it('count only what is under a folder that was made up, which has no messages of its own', () => {
    const made = [folder('Archive/2025'), folder('Archive/2026')]
    const unread = { [made[0].id]: 3, [made[1].id]: 5 }
    expect(visibleRows(buildFolderTree(made), new Set(), unread)[0].count).toBe(0)
    expect(visibleRows(buildFolderTree(made), new Set(['Archive']), unread)[0].count).toBe(8)
  })
})
