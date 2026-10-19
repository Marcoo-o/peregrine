import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { toastError } from '@renderer/state/toastStore'

export interface ContextMenuItem {
  id: string
  label: string
  icon?: LucideIcon
  danger?: boolean
  disabled?: boolean
  /** Renders a divider above this entry. */
  separatorBefore?: boolean
  /** May be async. Entries that ask something first return a promise. */
  run: () => void | Promise<void>
}

export interface ContextMenuState {
  x: number
  y: number
  items: ContextMenuItem[]
}

interface ContextMenuProps {
  state: ContextMenuState | null
  onClose: () => void
}

/** Shared right-click menu: positioned at the pointer and kept inside the window. */
function ContextMenu({ state, onClose }: ContextMenuProps): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: 0, y: 0 })

  useLayoutEffect(() => {
    if (!state) return
    const element = ref.current
    const width = element?.offsetWidth ?? 200
    const height = element?.offsetHeight ?? 200
    setPosition({
      x: Math.min(state.x, window.innerWidth - width - 8),
      y: Math.min(state.y, window.innerHeight - height - 8)
    })
  }, [state])

  useEffect(() => {
    if (!state) return
    const close = (): void => onClose()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [state, onClose])

  if (!state) return null

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: position.x, top: position.y }}
      onMouseDown={(event) => event.stopPropagation()}
      role="menu"
    >
      {state.items.map((item) => {
        const Icon = item.icon
        return (
          <div key={item.id}>
            {item.separatorBefore && <div className="context-menu-separator" />}
            <button
              role="menuitem"
              className={item.danger ? 'context-menu-item danger' : 'context-menu-item'}
              disabled={item.disabled}
              onClick={() => {
                onClose()
                // The menu is gone by now, so a failure has nowhere to surface but a toast.
                void Promise.resolve(item.run()).catch((err) => toastError(err, item.label))
              }}
            >
              {Icon && <Icon size={13} strokeWidth={1.75} />}
              {item.label}
            </button>
          </div>
        )
      })}
    </div>
  )
}

export default ContextMenu
