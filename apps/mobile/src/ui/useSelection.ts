import { useEffect, useMemo, useState } from 'react'
import { BackHandler } from 'react-native'
import { keyOf, pickedIn, toggled, type Picked } from '../app/selection'

/** What can be done to the messages that are chosen. The controller of the application does all of it. */
export interface SelectionActions {
  markRead(picked: Picked[], read: boolean): Promise<void>
  toggleStar(picked: Picked[]): Promise<void>
  archive(picked: Picked[]): Promise<string | undefined>
  markAsJunk(picked: Picked[]): Promise<string | undefined>
  remove(picked: Picked[]): Promise<void>
}

/**
 * Several messages of a list chosen to have one thing done to all of them: a long press chooses the first,
 * a tap then chooses or unchooses more, and doing something ends the choice. The back button ends it before
 * it does anything else, which is what a choice that can be left that way is expected to do.
 */
export function useSelection<T extends Picked>(shown: readonly T[], actions: SelectionActions) {
  const [keys, setKeys] = useState<ReadonlySet<string>>(new Set())
  const [notice, setNotice] = useState<string | undefined>()
  const picked = useMemo(() => pickedIn(shown, keys), [shown, keys])
  const selecting = picked.length > 0

  const clear = () => setKeys(new Set())

  useEffect(() => {
    if (!selecting) return undefined
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setKeys(new Set())
      return true
    })
    return () => subscription.remove()
  }, [selecting])

  /** Does a thing to the chosen messages, says what there is to say about it, and ends the choice. */
  const act = async (thing: () => Promise<string | undefined | void>) => {
    const said = await thing()
    setNotice(said || undefined)
    clear()
  }

  return {
    picked,
    selecting,
    notice,
    isChosen: (message: Picked) => keys.has(keyOf(message)),
    toggle: (message: Picked) => setKeys((current) => toggled(current, keyOf(message))),
    chooseAll: () => setKeys(new Set(shown.map(keyOf))),
    clear,
    markRead: (read: boolean) => act(() => actions.markRead(picked, read)),
    toggleStar: () => act(() => actions.toggleStar(picked)),
    archive: () => act(() => actions.archive(picked)),
    markAsJunk: () => act(() => actions.markAsJunk(picked)),
    remove: () => act(() => actions.remove(picked)),
    // One message that was swiped, which is not a choice and has nothing to do with the one that is being made.
    archiveMessage: async (message: Picked) => setNotice((await actions.archive([message])) || undefined),
    removeMessage: async (message: Picked) => {
      await actions.remove([message])
      setNotice(undefined)
    }
  }
}

export type Selection = ReturnType<typeof useSelection>
