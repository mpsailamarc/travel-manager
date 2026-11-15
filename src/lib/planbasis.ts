// What an itinerary was made for. When the trip's details change afterwards (other dates, destination, pace, budget level,
// interests, start or end), the plan may no longer fit: the app says what changed and offers new itinerary ideas.
// Who is travelling is not part of it: that's set in the Budget tab and only changes the costs.

import type { Trip } from '../types'

interface Basis {
  countries: string[]
  cities: string[]
  start: string
  end: string
  style: string
  level: string
  interests: string[]
  from: string
  to: string
}

function basisOf(t: Trip): Basis {
  return {
    countries: [...t.countryCodes].sort(),
    cities: t.cities,
    start: t.startDate,
    end: t.endDate,
    style: t.style,
    level: t.budgetLevel,
    interests: [...t.interests].sort(),
    from: t.startPlace?.name ?? '',
    to: t.endPlace?.name ?? '',
  }
}

export const planInputs = (t: Trip) => JSON.stringify(basisOf(t))

const LABELS: Record<keyof Basis, string> = {
  countries: 'destination',
  cities: 'places',
  start: 'dates',
  end: 'dates',
  style: 'pace',
  level: 'budget level',
  interests: 'interests',
  from: 'start or end',
  to: 'start or end',
}

/** What changed since the itinerary was made, in words ("dates, pace"), or nothing when it still fits (or there is none). */
export function planChanges(t: Trip): string[] {
  if (!t.planBasis) return []
  let was: Basis
  try {
    was = JSON.parse(t.planBasis)
  } catch {
    return []
  }
  const now = basisOf(t)
  const changed = (Object.keys(LABELS) as (keyof Basis)[]).filter((k) => JSON.stringify(was[k] ?? null) !== JSON.stringify(now[k]))
  // The places follow the itinerary itself (its route), so a change there alone isn't news.
  const words = [...new Set(changed.filter((k) => k !== 'cities').map((k) => LABELS[k]))]
  return words
}
