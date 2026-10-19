import { describe, expect, it } from 'vitest'
import { movePayloadWithout, type PendingMovePayload } from './pendingActions'

const QUEUED: PendingMovePayload = {
  sourceFolderId: 'inbox',
  targetFolderId: 'archiv',
  uids: [11, 12, 13]
}

describe('movePayloadWithout', () => {
  it('leaves the other messages of the same move alone', () => {
    expect(movePayloadWithout(QUEUED, [12])).toEqual({
      sourceFolderId: 'inbox',
      targetFolderId: 'archiv',
      uids: [11, 13]
    })
  })

  // An empty move would still be replayed, would find nothing to act on, and would be dropped
  // as a failure. Noise for an action that no longer means anything.
  it('reports an emptied move as gone rather than as an empty one', () => {
    expect(movePayloadWithout(QUEUED, [11, 12, 13])).toBeNull()
    expect(movePayloadWithout(QUEUED, [13, 12, 11, 99])).toBeNull()
  })

  it('changes nothing when none of the messages are in it', () => {
    expect(movePayloadWithout(QUEUED, [99])).toEqual(QUEUED)
  })

  // The target is what a second decision changes, so it must survive the rewrite untouched:
  // the messages left behind are still going where the first decision said.
  it('keeps the target of the move it trims', () => {
    expect(movePayloadWithout(QUEUED, [11])?.targetFolderId).toBe('archiv')
    expect(movePayloadWithout(QUEUED, [11])?.sourceFolderId).toBe('inbox')
  })

  it('does not modify the payload handed in', () => {
    movePayloadWithout(QUEUED, [11, 12])
    expect(QUEUED.uids).toEqual([11, 12, 13])
  })
})
