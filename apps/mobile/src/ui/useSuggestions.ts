import { useEffect, useState } from 'react'
import { typedPart, type Contact } from '../contacts'

/**
 * The people to suggest for the address being typed in a field, while the field is the one that is typed in. A
 * suggestion that arrives after the text has moved on is not for it any more and is dropped.
 */
export function useSuggestions(suggest: (typed: string) => Promise<Contact[]>, text: string, active: boolean): Contact[] {
  const [found, setFound] = useState<Contact[]>([])
  useEffect(() => {
    const { typed } = typedPart(text)
    if (!active || typed === '') {
      setFound([])
      return undefined
    }
    let current = true
    suggest(typed).then(
      (contacts) => current && setFound(contacts),
      () => current && setFound([])
    )
    return () => {
      current = false
    }
  }, [suggest, text, active])
  return found
}
