// Where you sleep, one stay per stretch of nights in a city. Chatbots write stays every which way: one per night, the
// same hotel twice with different nights, none at all for a city. The trip's stays are tidied to one per city stretch:
// repeats are merged, a stay running into the next city is cut back, and nights with nothing get a placeholder at the
// city centre ("Hotel in Amsterdam (to choose)") so every day starts and ends somewhere. Stays you set yourself — booked,
// with a booking reference, or edited — are never touched; a city can have two hotels that way.

import { db, touchTrip } from '../db'
import type { Day, Item, Trip } from '../types'
import { addDays, dateRange } from './dates'
import { haversineM } from './geo'
import { uid } from './ids'
import { transportSpan } from './tz'

const CAMPER = /camper|campervan|motorhome|motor home|\bRV\b|camping[- ]car|wohnmobil|camper van/i
export const isCamperRental = (i: Item) => i.kind === 'car' && CAMPER.test(i.title)

/**
 * The nights spent in a camper van: the whole trip when you said so (Trip details → Where you sleep), else from a camper
 * rental's pick-up to its return (or the end of the trip) when the plan has one. Hotels otherwise.
 */
export function camperNights(trip: Trip, items: Item[]): (night: string) => boolean {
  if (trip.sleep === 'camper') return () => true
  if (trip.sleep === 'hotels') return () => false
  const dates = items.filter((i) => isCamperRental(i) && i.status !== 'skipped').map((i) => i.date).sort()
  if (!dates.length) return () => false
  const [from, to] = [dates[0], dates.length > 1 ? dates[dates.length - 1] : trip.endDate]
  return (n) => n >= from && n < to
}

/** A stay that's a campsite (or an aire, a campground…) rather than a hotel. */
export const isCampsite = (s: Item) => /campsite|camping|campground|caravan park|\baire\b|holiday park|RV park/i.test(s.title)

export const nightsOf = (s: Item) => Array.from({ length: Math.max(1, s.nights ?? 1) }, (_, k) => addDays(s.date, k))
export const isPlaceholderStay = (s: Item) => /\(to choose\)$/.test(s.title)
const keeps = (s: Item) => !!s.hotelSet || !!s.bookingRef || s.status === 'booked' || s.status === 'done'

export interface Stretch {
  city: string
  nights: string[] // the dates of the nights, in order
  lat?: number
  lon?: number
}

/**
 * The trip's nights grouped by city: the night of a day is spent in that day's city. Nights spent travelling (an
 * overnight flight or train) and nights at home (where the trip starts) need no hotel.
 */
export function stayStretches(trip: Trip, days: Day[], items: Item[]): Stretch[] {
  const ctx = { trip, days, items }
  // A long journey that lands on a later day takes that night; one leaving in the small hours (a 01:30 flight) takes the
  // night before: you leave for it in the evening.
  const inTransit = new Set(
    items
      .filter((i) => ['flight', 'train', 'ferry', 'bus'].includes(i.kind) && i.status !== 'skipped')
      .flatMap((i) => {
        const span = transportSpan(i, ctx)
        if (!span || span.durationMin < 4 * 60) return []
        return [...(span.arrDate > i.date ? [i.date] : []), ...(i.startTime && i.startTime < '05:00' ? [addDays(i.date, -1)] : [])]
      }),
  )
  const home = trip.startPlace?.lat != null && trip.startPlace.lon != null ? { lat: trip.startPlace.lat, lon: trip.startPlace.lon } : undefined
  const out: Stretch[] = []
  for (const n of dateRange(trip.startDate, addDays(trip.endDate, -1))) {
    const d = days.find((x) => x.date === n)
    if (!d?.city || inTransit.has(n)) continue
    if (home && d.lat != null && d.lon != null && haversineM(home, { lat: d.lat, lon: d.lon }) < 50_000) continue
    const last = out[out.length - 1]
    if (last && last.city === d.city && addDays(last.nights[last.nights.length - 1], 1) === n) last.nights.push(n)
    else out.push({ city: d.city, nights: [n], lat: d.lat, lon: d.lon })
  }
  return out
}

/** What tidying changes: stays to write (new or changed) and stays to remove. */
export function tidyStaysPlan(trip: Trip, days: Day[], items: Item[]): { put: Item[]; remove: string[] } {
  const stays = items.filter((i) => i.kind === 'stay' && i.status !== 'skipped')
  const put: Item[] = []
  const remove = new Set<string>()
  const stretches = stayStretches(trip, days, items)
  // Each of the chatbot's stays belongs to the stretch it checks in during, else the first one it runs into (a stay
  // starting on the night of the flight in).
  const homeOf = (s: Item) => stretches.find((st) => st.nights.includes(s.date)) ?? stretches.find((st) => nightsOf(s).some((n) => st.nights.includes(n)))
  const inVan = camperNights(trip, items)
  for (const st of stretches) {
    const inStretch = new Set(st.nights)
    const keepers = stays.filter((s) => keeps(s) && nightsOf(s).some((n) => inStretch.has(n)))
    const covered = new Set(keepers.flatMap(nightsOf))
    // The chatbot's stays of this stretch (one per night, or overlapping): merged into one per run of nights.
    const own = stays.filter((s) => !keeps(s) && homeOf(s) === st).sort((a, b) => a.date.localeCompare(b.date))
    const costed = own.filter((s) => s.cost?.amount)
    const perNight = costed.length ? costed.reduce((m, s) => m + s.cost!.amount, 0) / costed.reduce((m, s) => m + (s.nights ?? 1), 0) : undefined
    const runs: string[][] = []
    for (const n of st.nights) {
      if (covered.has(n)) continue
      const r = runs[runs.length - 1]
      // A run is all hotel nights or all van nights (picking the camper up mid-stay starts a new one).
      if (r && addDays(r[r.length - 1], 1) === n && inVan(r[0]) === inVan(n)) r.push(n)
      else runs.push([n])
    }
    const free = [...own]
    for (const run of runs) {
      // The best of the chatbot's stays for these nights: the one overlapping them most, with a place if possible.
      const overlap = (s: Item) => nightsOf(s).filter((n) => run.includes(n)).length + (s.location?.lat != null ? 0.5 : 0)
      const pick = [...free].sort((a, b) => overlap(b) - overlap(a))[0]
      const centre = st.lat != null && st.lon != null ? { lat: st.lat, lon: st.lon } : undefined
      const base: Item = pick
        ? { ...pick }
        : { id: uid(), tripId: trip.id, date: run[0], kind: 'stay', title: inVan(run[0]) ? `Campsite near ${st.city} (to choose)` : `Hotel in ${st.city} (to choose)`, status: 'idea', order: -1 }
      if (pick) free.splice(free.indexOf(pick), 1)
      const location = base.location?.lat != null ? base.location : centre ? { name: base.location?.name || `${st.city} centre`, ...centre } : base.location
      const cost = perNight != null && base.cost ? { ...base.cost, amount: Math.round(perNight * run.length) } : base.cost
      const next: Item = { ...base, date: run[0], nights: run.length, location, cost }
      if (!pick || JSON.stringify([pick.date, pick.nights, pick.location, pick.cost]) !== JSON.stringify([next.date, next.nights, next.location, next.cost])) put.push(next)
    }
    for (const s of free) remove.add(s.id)
  }
  return { put, remove: [...remove] }
}

/** Tidies the trip's stays (see above). Returns whether anything changed. */
export async function tidyStays(tripId: string): Promise<boolean> {
  const trip = await db.trips.get(tripId)
  if (!trip) return false
  const [days, items] = await Promise.all([db.days.where('tripId').equals(tripId).toArray(), db.items.where('tripId').equals(tripId).toArray()])
  const { put, remove } = tidyStaysPlan(trip, days, items)
  if (!put.length && !remove.length) return false
  await db.transaction('rw', db.items, async () => {
    if (remove.length) await db.items.bulkDelete(remove)
    if (put.length) await db.items.bulkPut(put)
  })
  await touchTrip(tripId)
  return true
}
