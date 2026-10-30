import { createContext, useContext } from 'react'
import { DEFAULT_SAFETY, type SafetySettings } from '../safety'

/** What the user switched off or on of the checks, for the screens that open links. */
export const SafetyContext = createContext<SafetySettings>(DEFAULT_SAFETY)

export const useSafety = (): SafetySettings => useContext(SafetyContext)
