/** How far a row has to be moved, of its width, before letting go does what the swipe is for. */
export const COMMIT_FRACTION = 0.35

/** How far a touch has to move sideways before it is a swipe, and how much more sideways than up or down it has to be. */
export const START_DISTANCE = 12
export const SIDEWAYS_OVER_VERTICAL = 1.5

export type SwipeResult = 'archive' | 'delete' | null

/**
 * Whether a touch that has moved by `dx` and `dy` is a swipe of the row. A touch that goes mostly up or down is the
 * list's own, and a row is not taken from the list by one, so scrolling is never in the way of the swipe.
 */
export function isSwipe(dx: number, dy: number): boolean {
  return Math.abs(dx) > START_DISTANCE && Math.abs(dx) > Math.abs(dy) * SIDEWAYS_OVER_VERTICAL
}

/** What letting go does with a row that has been moved by `dx`: to the right archives, to the left deletes, short of far enough nothing. */
export function swipeResult(dx: number, width: number): SwipeResult {
  const needed = width * COMMIT_FRACTION
  if (dx > needed) return 'archive'
  if (dx < -needed) return 'delete'
  return null
}
