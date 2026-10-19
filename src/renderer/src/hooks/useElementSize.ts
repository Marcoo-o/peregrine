import { useCallback, useEffect, useState } from 'react'

export interface ElementSize {
  width: number
  height: number
}

/**
 * Reports the live size of a DOM node. The virtualized message list needs a pixel height, and
 * that height now depends on a draggable splitter rather than the window, so it has to be
 * measured instead of derived from window.innerHeight.
 *
 * The node is tracked through a callback ref rather than a plain ref object: the measured
 * element only mounts once the list has rows, which happens after the first render. An effect
 * keyed on a ref object would have run against a null ref and never observed anything.
 */
export function useElementSize<T extends HTMLElement>(): [(node: T | null) => void, ElementSize] {
  const [node, setNode] = useState<T | null>(null)
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 })

  const ref = useCallback((next: T | null) => setNode(next), [])

  useEffect(() => {
    if (!node) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) setSize({ width: rect.width, height: rect.height })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [node])

  return [ref, size]
}
