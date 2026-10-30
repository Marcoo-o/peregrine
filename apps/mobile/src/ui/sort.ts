import { createContext, useContext } from 'react'
import { DEFAULT_SORT, type ListSort } from '../listSort'

/** How the lists are ordered, and the way to change it: what every list and its head need, the order being one for all of them. */
export interface SortControl {
  sort: ListSort
  setSort: (sort: ListSort) => void
  /** Whether replies are grouped into conversations, which the lists are drawn by as well as ordered. */
  conversations: boolean
}

export const SortContext = createContext<SortControl>({ sort: DEFAULT_SORT, setSort: () => undefined, conversations: true })

export const useSort = (): SortControl => useContext(SortContext)
