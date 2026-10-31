import { createContext, useContext } from 'react'

/** The message that is open on the right while the list is on the left, to mark it in the list. Null when there is no second pane. */
export interface OpenMessage {
  folderId: string
  uid: number
}

export const OpenMessageContext = createContext<OpenMessage | null>(null)
export const useOpenMessage = (): OpenMessage | null => useContext(OpenMessageContext)
