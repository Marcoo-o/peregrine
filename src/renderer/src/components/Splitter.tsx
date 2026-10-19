import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react'

interface SplitterProps {
  /** 'x' moves a vertical divider (resizes width), 'y' a horizontal one (resizes height). */
  axis: 'x' | 'y'
  /** Size of the pane being resized when the drag starts. */
  size: number
  min: number
  max: number
  /** Sign of the delta: 1 when the pane grows towards the pointer, -1 when it shrinks. */
  invert?: boolean
  onResize: (size: number) => void
  onResizeEnd: (size: number) => void
}

/**
 * Pointer events are captured on the handle itself, so dragging keeps working when the cursor
 * flies over the iframe of the reading pane. A plain mousemove listener on window would lose
 * the events to the sandboxed document.
 */
function Splitter({ axis, size, min, max, invert, onResize, onResizeEnd }: SplitterProps): JSX.Element {
  const dragRef = useRef<{ origin: number; startSize: number } | null>(null)
  const latestRef = useRef(size)

  useEffect(() => {
    latestRef.current = size
  }, [size])

  function clamp(value: number): number {
    return Math.min(max, Math.max(min, value))
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { origin: axis === 'x' ? event.clientX : event.clientY, startSize: size }
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current
    if (!drag) return
    const current = axis === 'x' ? event.clientX : event.clientY
    const delta = (current - drag.origin) * (invert ? -1 : 1)
    const next = clamp(drag.startSize + delta)
    latestRef.current = next
    onResize(next)
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>): void {
    if (!dragRef.current) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    dragRef.current = null
    onResizeEnd(latestRef.current)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const decrease = axis === 'x' ? 'ArrowLeft' : 'ArrowUp'
    const increase = axis === 'x' ? 'ArrowRight' : 'ArrowDown'
    if (event.key !== decrease && event.key !== increase) return
    event.preventDefault()
    const step = (event.key === increase ? 16 : -16) * (invert ? -1 : 1)
    const next = clamp(size + step)
    onResize(next)
    onResizeEnd(next)
  }

  return (
    <div
      className={axis === 'x' ? 'splitter splitter-x' : 'splitter splitter-y'}
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
    />
  )
}

export default Splitter
