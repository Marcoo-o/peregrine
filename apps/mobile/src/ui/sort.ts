import { createContext, useContext } from 'react'
import { DEFAULT_SORT, type ListSort } from '../listSort'

/** How the lists are ordered, and the way to change it: what every list and its head need, the order being one for all of them. */
export interface SortControl {
  sort: ListSort
  setSort: (sort: ListSort) => void
}

export const SortContext = createContext<SortControl>({ sort: DEFAULT_SORT, setSort: () => undefined })

export const useSort = (): SortControl => useContext(SortContext)
