import { createContext, useContext } from 'react'
import type { Screen } from '../app/screens'
import type { UnifiedRole } from '../unified'

/** What the screens can ask of the sidebar. */
export interface DrawerControl {
  open: () => void
}

export const DrawerContext = createContext<DrawerControl>({ open: () => undefined })

/** The sidebar, for a screen that has a button for it. */
export const useDrawer = (): DrawerControl => useContext(DrawerContext)

/** The place the sidebar marks as the one the user is in: a role of all accounts, or a folder of an account. */
export interface Location {
  role?: UnifiedRole
  folderId?: string
}

export function locationOf(screen: Screen): Location {
  if (screen.name === 'unified') return { role: screen.role }
  if (screen.name === 'messages') return { folderId: screen.folder.id }
  return {}
}

/** The screens that the sidebar can be pulled out on: the lists, and the places that lead to them. */
export const showsDrawer = (name: Screen['name']): boolean =>
  name === 'unified' || name === 'messages' || name === 'folders' || name === 'accounts' || name === 'search'
