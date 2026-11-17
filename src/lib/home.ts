// Where the trip starts and ends (home, usually) is only that: a starting point. It isn't one of the trip's places, gets
// no activities, no ideas from ChatGPT and no tab in the City planner — unless the whole trip is there (a trip at home).

import { db } from '../db'
import type { Day, Item, Money, Place, Trip } from '../types'
import { haversineM } from './geo'
import { cityBase, sameCity } from './favorites'
import { addDays, daysBetween } from './dates'
import { CITIES, cityIn, looksLikeHub, nearTrip } from './cities'
import { country } from './countries'
import { uid } from './ids'

/** Is this place (by name, or within 50 km) where the trip starts or ends? */
export function isHome(trip: Pick<Trip, 'startPlace' | 'endPlace'>, place: { name?: string; lat?: number; lon?: number }): boolean {
  for (const h of [trip.startPlace, trip.endPlace]) {
    if (!h?.name) continue
    if (place.name && (sameCity(cityBase(place.name), cityBase(h.name.split(',')[0])) || sameCity(place.name, h.name))) return true
    if (h.lat != null && h.lon != null && place.lat != null && place.lon != null && haversineM({ lat: h.lat, lon: h.lon }, { lat: place.lat, lon: place.lon }) < 50_000) return true
  }
  return false
}

/** Is this place home, reading well-known airports as their city ("Sydney Kingsford Smith (SYD)" is Sydney)? */
export function atHome(trip: Pick<Trip, 'startPlace' | 'endPlace'>, p?: Place): boolean {
  if (!p) return false
  const c = cityIn(p.name)
  return isHome(trip, p) || (!!c && isHome(trip, { name: c.name, lat: c.lat, lon: c.lon }))
}

const GROUND = new Set(['taxi', 'drive', 'car', 'bus', 'train'])

/**
 * Getting to the airport at home, or back from it: the trip starts and ends at home's airport, so that isn't planned (it
 * landed in the middle of the flight on the destination's clock). Booked ones stay.
 */
export function isHomeTransfer(trip: Pick<Trip, 'startPlace' | 'endPlace'>, i: Pick<Item, 'kind' | 'from' | 'to' | 'status' | 'bookingRef'>): boolean {
  if (!GROUND.has(i.kind) || i.status === 'booked' || i.bookingRef) return false
  return (atHome(trip, i.to) && (!i.from || atHome(trip, i.from))) || (atHome(trip, i.from) && !i.to)
}

const JOURNEY_KINDS = new Set(['flight', 'train', 'bus', 'ferry', 'car', 'drive', 'taxi'])

export interface HomeLeg {
  date: string
  from: Place
  to: Place
  /** The other end's flight price, if it has one: the way back usually costs about the same. */
  cost?: Money
}

/**
 * The flight out or home a plan is missing. A chatbot sometimes forgets the way back: when home is far (over 500 km) from
 * where the trip is and no journey of the first (or second) half goes from or to home, the leg to add, with its date
 * (the first day; the day after the last night away) and the places at both ends.
 */
export function missingHomeLegs(trip: Trip, days: Day[], items: Item[]): { out?: HomeLeg; back?: HomeLeg } {
  if ((trip.getThere ?? 'plane') !== 'plane') return {} // by car, train, bus or ferry: no flight to add
  const start = trip.startPlace
  const end = trip.endPlace?.name ? trip.endPlace : trip.startPlace
  const away = days
    .filter((d) => d.city && d.lat != null && d.lon != null && !isHome(trip, { name: d.city, lat: d.lat, lon: d.lon }))
    .sort((a, b) => a.date.localeCompare(b.date))
  if (!away.length) return {}
  const far = (h: Place | undefined, d: Day) => h?.lat != null && h.lon != null && haversineM({ lat: h.lat, lon: h.lon }, { lat: d.lat!, lon: d.lon! }) > 500_000
  const names = [start, end].flatMap((h) => (h?.name ? [cityBase(h.name.split(',')[0]).toLowerCase()] : []))
  const homeEnd = (p?: Place) => atHome(trip, p)
  const touchesHome = (i: Item) =>
    homeEnd(i.from) || homeEnd(i.to) || /\bhome\b/i.test(i.title) || names.some((n) => n && i.title.toLowerCase().includes(n))
  const legs = items.filter((i) => JOURNEY_KINDS.has(i.kind) && i.status !== 'skipped' && touchesHome(i))
  const mid = addDays(trip.startDate, Math.floor(daysBetween(trip.startDate, trip.endDate) / 2))
  // A flight with no place at one end counts as the way out (first day, no "from") or home (last days, no "to").
  const vague = items.filter((i) => i.kind === 'flight' && i.status !== 'skipped')
  const outs = [...legs.filter((i) => i.date <= mid), ...vague.filter((i) => i.date === trip.startDate && !i.from)]
  const backs = [...legs.filter((i) => i.date > mid || (homeEnd(i.to) && !homeEnd(i.from))), ...vague.filter((i) => i.date >= away[away.length - 1].date && !i.to)]
  const priced = (l: Item[]) => l.find((i) => i.kind === 'flight' && i.cost?.amount)?.cost
  const first = away[0]
  const last = away[away.length - 1]
  const place = (d: Day): Place => ({ name: d.city!, lat: d.lat, lon: d.lon })
  return {
    out: start && far(start, first) && !outs.length ? { date: trip.startDate, from: start, to: place(first), cost: priced(backs) } : undefined,
    back:
      end && far(end, last) && !backs.length
        ? { date: last.date < trip.endDate ? addDays(last.date, 1) : last.date, from: place(last), to: end, cost: priced(outs) }
        : undefined,
  }
}

/**
 * Adds the flight out or home a plan forgot, as an idea to book (no times yet), priced like the other way when that has
 * a price, so it's in the plan and the budget. Returns how many it added.
 */
export async function addMissingHomeLegs(tripId: string): Promise<number> {
  const trip = await db.trips.get(tripId)
  if (!trip) return 0
  const [days, items] = await Promise.all([db.days.where('tripId').equals(tripId).toArray(), db.items.where('tripId').equals(tripId).toArray()])
  const { out, back } = missingHomeLegs(trip, days, items)
  const short = (p: Place) => p.name.split(',')[0]
  const add = (l: HomeLeg, title: string): Item => ({
    id: uid(),
    tripId,
    date: l.date,
    kind: 'flight',
    title,
    from: l.from,
    to: l.to,
    cost: l.cost,
    status: 'idea',
    notes: "The itinerary had no flight here: added so it's in the plan and the budget. Set the times once booked.",
    order: title.startsWith('Flight home') ? 999 : -1,
  })
  const rows = [
    ...(out ? [add(out, `Flight ${short(out.from)} → ${short(out.to)}`)] : []),
    ...(back ? [add(back, `Flight home: ${short(back.from)} → ${short(back.to)}`)] : []),
  ]
  if (rows.length) await db.items.bulkAdd(rows)
  return rows.length
}

/** Where the trip is: its days' places, its countries' capitals, and home. Name-only matches far from all of them don't count. */
export function tripArea(trip: Pick<Trip, 'startPlace' | 'endPlace' | 'countryCodes'>, days: Pick<Day, 'lat' | 'lon'>[]): { lat: number; lon: number }[] {
  const pts: { lat: number; lon: number }[] = []
  for (const d of days) if (d.lat != null && d.lon != null) pts.push({ lat: d.lat, lon: d.lon })
  for (const c of trip.countryCodes) {
    const cap = country(c)?.capital
    if (cap) pts.push({ lat: cap.lat, lon: cap.lon })
  }
  for (const h of [trip.startPlace, trip.endPlace]) if (h?.lat != null && h.lon != null) pts.push({ lat: h.lat, lon: h.lon })
  return pts
}

const GROUND_KINDS = new Set(['taxi', 'drive', 'car', 'bus', 'train'])

/**
 * Journeys an older version sent to the wrong side of the world: a bus to "Casablanca" (in Chile) got the coordinates of
 * Casablanca in Morocco from the list of well-known cities. Such an end (exactly that city's coordinates, a plain town
 * name, far from the trip) loses its coordinates, so it's placed by the trip again. Returns the changes to make.
 */
export function misplacedEnds(trip: Pick<Trip, 'startPlace' | 'endPlace' | 'countryCodes'>, days: Pick<Day, 'lat' | 'lon'>[], items: Item[]) {
  const area = tripArea(trip, days)
  if (!area.length) return []
  const wrong = (p?: Place) => !!p && p.lat != null && p.lon != null && !looksLikeHub(p.name) && CITIES.some((c) => c.lat === p.lat && c.lon === p.lon && !nearTrip(c, area))
  return items.flatMap((i) => {
    if (!GROUND_KINDS.has(i.kind) || (!wrong(i.from) && !wrong(i.to))) return []
    const strip = (p?: Place) => (p && wrong(p) ? { name: p.name, country: p.country } : p)
    return [{ key: i.id, changes: { from: strip(i.from), to: strip(i.to) } }]
  })
}
