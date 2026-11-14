// When an item now ends later (a landing at 06:28 instead of 06:00), push the following items of that day back
// just enough so nothing overlaps. Booked items are fixed points: the push stops there.

import type { HHMM, Item } from '../types'
import { hhmmToMin, minToHHMM } from './dates'

export interface RippleMove {
  item: Item
  start: HHMM
  end?: HHMM
}

export interface RipplePlan {
  moves: RippleMove[]
  /** A booked item the push ran into: it stays where it is. */
  blockedBy?: Item
}

const LAST_MINUTE = 23 * 60 + 59

/**
 * @param dayItems  every item on the day (the edited one may be among them; it is ignored)
 * @param edited    the times as they are now in the form
 * @param original  the times before the edit (to tell whether anything changed)
 */
export function planRipple(
  dayItems: Item[],
  edited: { id?: string; startTime?: HHMM; endTime?: HHMM },
  original?: { startTime?: HHMM; endTime?: HHMM },
): RipplePlan {
  const none: RipplePlan = { moves: [] }
  if (!edited.endTime) return none
  if (original && original.startTime === edited.startTime && original.endTime === edited.endTime) return none
  const end = hhmmToMin(edited.endTime)
  // Ends the next day (overnight flight): nothing on this day is affected.
  if (edited.startTime && hhmmToMin(edited.startTime) > end) return none
  const anchor = edited.startTime ?? original?.endTime
  if (!anchor) return none
  // From the earlier of the old and new start: an item moved later now overlaps what used to come after it.
  const from = Math.min(hhmmToMin(anchor), original?.startTime ? hhmmToMin(original.startTime) : Infinity)

  const later = dayItems
    .filter((i) => i.id !== edited.id && i.startTime && hhmmToMin(i.startTime) >= from && i.status !== 'done' && i.status !== 'skipped')
    .sort((a, b) => hhmmToMin(a.startTime!) - hhmmToMin(b.startTime!) || a.order - b.order)

  // Nothing may be pushed past a booked item (a train at 09:45 stays at 09:45): the push stops before it.
  const fixed = later.find((i) => i.status === 'booked' || i.bookingRef)
  const fixedStart = fixed ? hhmmToMin(fixed.startTime!) : Infinity

  const moves: RippleMove[] = []
  let cursor = end
  for (const it of later) {
    const start = hhmmToMin(it.startTime!)
    if (start >= cursor) break // no overlap here, so nothing further along is affected either
    if (it.status === 'booked' || it.bookingRef) return { moves, blockedBy: it }
    const delta = cursor - start
    const newStart = Math.min(cursor, LAST_MINUTE)
    const itEnd = it.endTime ? hhmmToMin(it.endTime) : undefined
    // Keep its duration; an item that runs past midnight keeps its end as it is.
    const newEnd = itEnd != null && itEnd >= start ? Math.min(itEnd + delta, LAST_MINUTE) : undefined
    if ((newEnd ?? newStart) > fixedStart) return { moves, blockedBy: fixed }
    moves.push({ item: it, start: minToHHMM(newStart), end: newEnd != null ? minToHHMM(newEnd) : it.endTime })
    cursor = newEnd ?? newStart
  }
  return { moves }
}
