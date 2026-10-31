import type { Folder } from './folders'
import { isInbox } from './unified'
import { language } from './i18n'

/** A place in the tree of folders: a folder, or a name that folders sit under that is not one itself. */
export interface TreeNode {
  /** The path on the server, which is what tells it from the others. */
  path: string
  /** What it is called without the folders it sits in. */
  label: string
  /** The folder, or null for a parent that cannot be chosen and was made up for the folders under it. */
  folder: Folder | null
  children: TreeNode[]
}

/** The order of the folders that have a job, as they are used. The inbox is first and is not asked about here. */
const ROLE_ORDER = ['\\Drafts', '\\Sent', '\\Archive', '\\Junk', '\\Trash']

/** Where a node goes among the others at the top: the inbox, the folders with a job, the rest. */
function rankOf(node: TreeNode): number {
  const { folder } = node
  if (folder && isInbox(folder)) return 0
  const role = folder?.specialUse ? ROLE_ORDER.indexOf(folder.specialUse) : -1
  return role === -1 ? ROLE_ORDER.length + 1 : role + 1
}

const byName = (a: TreeNode, b: TreeNode): number => a.label.localeCompare(b.label, language.code, { sensitivity: 'base' })

/**
 * The folders of an account as a tree, from where each says it sits. A folder that others sit in but that cannot
 * be chosen is not kept as one, so a name is made up for it, as many levels as are missing. The delimiter the
 * server uses is not stored, and is read from a folder that has a parent: what is between the two in its path.
 * At the top the inbox is first and then the folders with a job in the order they are used; the rest, and
 * everything under a folder, is by name.
 */
export function buildFolderTree(folders: Folder[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>(
    folders.map((folder) => [folder.imapPath, { path: folder.imapPath, label: folder.displayName, folder, children: [] }])
  )
  const roots: TreeNode[] = []

  /** The node for a path, made up with the ones above it when it is not a folder. */
  const ensure = (path: string, delimiter: string): TreeNode => {
    const known = nodes.get(path)
    if (known) return known
    const cut = delimiter ? path.lastIndexOf(delimiter) : -1
    const made: TreeNode = { path, label: cut === -1 ? path : path.slice(cut + delimiter.length), folder: null, children: [] }
    nodes.set(path, made)
    attach(made, cut === -1 ? null : path.slice(0, cut), delimiter)
    return made
  }

  const attach = (node: TreeNode, parentPath: string | null, delimiter: string): void => {
    if (parentPath === null) roots.push(node)
    else ensure(parentPath, delimiter).children.push(node)
  }

  for (const folder of folders) {
    const delimiter =
      folder.parentPath === null ? '' : folder.imapPath.slice(folder.parentPath.length, folder.imapPath.length - folder.displayName.length)
    attach(nodes.get(folder.imapPath)!, folder.parentPath, delimiter)
  }

  const order = (list: TreeNode[], top: boolean): void => {
    list.sort((a, b) => (top ? rankOf(a) - rankOf(b) : 0) || byName(a, b))
    for (const node of list) order(node.children, false)
  }
  order(roots, true)
  return roots
}

/** One line of the tree as it is shown. */
export interface TreeRow {
  node: TreeNode
  depth: number
  /** Whether it is open, or null for one that has nothing under it. */
  expanded: boolean | null
  /** The unread messages to put beside it: its own, and those under it too while it is closed. */
  count: number
}

function unreadUnder(node: TreeNode, unread: Record<string, number>): number {
  return node.children.reduce((sum, child) => sum + (child.folder ? (unread[child.folder.id] ?? 0) : 0) + unreadUnder(child, unread), 0)
}

/** The lines that are shown: every folder, but not those under one that is closed. `collapsed` holds paths. */
export function visibleRows(roots: TreeNode[], collapsed: ReadonlySet<string>, unread: Record<string, number>): TreeRow[] {
  const rows: TreeRow[] = []
  const walk = (nodes: TreeNode[], depth: number): void => {
    for (const node of nodes) {
      const closed = node.children.length > 0 && collapsed.has(node.path)
      const own = node.folder ? (unread[node.folder.id] ?? 0) : 0
      rows.push({
        node,
        depth,
        expanded: node.children.length === 0 ? null : !closed,
        count: closed ? own + unreadUnder(node, unread) : own
      })
      if (!closed) walk(node.children, depth + 1)
    }
  }
  walk(roots, 0)
  return rows
}
