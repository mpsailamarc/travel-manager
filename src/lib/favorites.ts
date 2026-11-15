// Favourites per city and "Plan my days": spread them over the days you spend in that city,
// grouped by neighbourhood and sized to your pace. Runs entirely in the browser.

import { adoptPlannerItems, db, getSettings, touchTrip } from '../db'
import type { Day, Favorite, GetAround, Item, Leg, Place, Settings, Trip, TripStyle } from '../types'
import { POI_CATEGORIES } from './apis'
import { matchesPlace } from './duplicates'
import { DEFAULT_WALK_MAX_MIN, planLeg } from './legs'
import { addDays, hhmmToMin, minToHHMM, today } from './dates'
import { centroid, haversineM, optimiseOrder, type LatLon } from './geo'
import { uid } from './ids'

export const CATEGORY_META: Record<string, { label: string; emoji: string; visitMin: number; indoor?: boolean }> = {
  ...POI_CATEGORIES,
  museum: { ...POI_CATEGORIES.museum, indoor: true },
  religious: { ...POI_CATEGORIES.religious, indoor: true },
  family: { ...POI_CATEGORIES.family, indoor: true },
  food: { label: 'Food & markets', emoji: '🍽️', visitMin: 60 },
  experience: { label: 'Experiences', emoji: '✨', visitMin: 90 },
  shopping: { label: 'Shopping', emoji: '🛍️', visitMin: 60 },
  daytrip: { label: 'Day trips', emoji: '🚌', visitMin: 420 },
}

export const categoryMeta = (c: string) => CATEGORY_META[c] ?? CATEGORY_META.attraction
export const isIndoor = (f: Favorite) => f.indoor ?? !!categoryMeta(f.category).indoor
const isDayTrip = (f: Favorite) => f.category === 'daytrip' || f.visitMin >= 300

export const sameCity = (a?: string, b?: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()
export const plannerTag = (city: string) => `fav:${city.trim().toLowerCase()}`

/** Favourites that belong to a plan day as part of its rebuilt walk (not the ones added on the day itself). */
const scheduled = (f: Favorite) => !!f.date && !f.itemId

/* ------------------------------ Day capacity ------------------------------ */

const PACE_MIN: Record<TripStyle, number> = { relaxed: 240, balanced: 360, packed: 510 }
const STOP_OVERHEAD = 15 // minutes of walking/queuing per stop, before the real route is known

function itemMinutes(it: Item): number {
  if (it.startTime && it.endTime) return Math.max(0, (hhmmToMin(it.endTime) - hhmmToMin(it.startTime) + 1440) % 1440)
  switch (it.kind) {
    case 'flight':
      return 300
    case 'train':
    case 'ferry':
    case 'car':
    case 'drive':
      return 180
    case 'bus':
      return 45
    case 'activity':
      return 90
    case 'walk':
      return it.walk ? it.walk.walkS / 60 + it.walk.stops.reduce((s, x) => s + x.visitMin, 0) : 120
    default:
      return 0 // meals, stays, notes, taxis
  }
}

/** Minutes left for sightseeing on a day, after what's already planned (other than rebuilt favourite walks). */
export function dayCapacity(trip: Trip, items: Item[], date: string): number {
  const fixed = items.filter((i) => i.date === date && !i.planner && i.status !== 'skipped')
  return Math.max(0, PACE_MIN[trip.style] - fixed.reduce((s, i) => s + itemMinutes(i), 0))
}

export const favMinutes = (f: Favorite) => f.visitMin + (f.lat != null ? STOP_OVERHEAD : 0)

/* ------------------------------ Plan my days ------------------------------ */

export interface PlanResult {
  assign: Map<string, string | undefined> // favorite id → date (undefined = backup)
}

/**
 * Pinned favourites stay where you put them. Day trips get a free day of their own. Everything with coordinates
 * is grouped by area (k-means, one group per day) and the groups are matched to days by available time;
 * overflow moves to the nearest day with room, or becomes a backup idea.
 */
export function planDays(favs: Favorite[], dates: string[], capacity: Map<string, number>): PlanResult {
  const assign = new Map<string, string | undefined>()
  const left = new Map(dates.map((d) => [d, capacity.get(d) ?? 0]))
  const takeTime = (d: string, f: Favorite) => left.set(d, (left.get(d) ?? 0) - favMinutes(f))

  for (const f of favs.filter((f) => f.pinned && f.date && dates.includes(f.date))) {
    assign.set(f.id, f.date)
    takeTime(f.date!, f)
  }
  const free = favs.filter((f) => !assign.has(f.id) && !f.itemId)

  // Day trips: each takes the emptiest remaining day.
  const fullDays = new Set<string>()
  for (const f of free.filter(isDayTrip)) {
    const day = dates.filter((d) => !fullDays.has(d) && (left.get(d) ?? 0) >= 300).sort((a, b) => left.get(b)! - left.get(a)!)[0]
    assign.set(f.id, day)
    if (day) {
      fullDays.add(day)
      left.set(day, 0)
    }
  }

  const open = dates.filter((d) => !fullDays.has(d) && (left.get(d) ?? 0) > 30)
  const geo = free.filter((f) => !isDayTrip(f) && f.lat != null && f.lon != null)
  const other = free.filter((f) => !isDayTrip(f) && (f.lat == null || f.lon == null))

  if (open.length && geo.length) {
    const groups = kMeans(geo as (Favorite & LatLon)[], Math.min(open.length, geo.length))
    const load = (g: Favorite[]) => g.reduce((s, f) => s + favMinutes(f), 0)
    // Biggest group to the day with most time.
    const byLoad = [...groups].sort((a, b) => load(b) - load(a))
    const byRoom = [...open].sort((a, b) => left.get(b)! - left.get(a)!)
    const dayOf = new Map<string, Favorite[]>()
    byLoad.forEach((g, i) => dayOf.set(byRoom[i], [...g]))
    for (const d of open) if (!dayOf.has(d)) dayOf.set(d, [])

    // Too full: move the stop farthest from the group's centre to the closest day that has room, else to backups.
    for (const d of open) {
      const g = dayOf.get(d)!
      while (g.length && load(g) > left.get(d)!) {
        const c = centroid(g as (Favorite & LatLon)[])!
        g.sort((a, b) => haversineM(c, a as LatLon) - haversineM(c, b as LatLon))
        const f = g.pop()!
        const target = open
          .filter((o) => o !== d && left.get(o)! - load(dayOf.get(o)!) >= favMinutes(f))
          .sort((a, b) => distTo(dayOf.get(a)!, f) - distTo(dayOf.get(b)!, f))[0]
        if (target) dayOf.get(target)!.push(f)
        else assign.set(f.id, undefined)
      }
    }
    for (const [d, g] of dayOf) for (const f of g) assign.set(f.id, d)
    for (const d of open) left.set(d, left.get(d)! - load(dayOf.get(d)!))
  }

  // Things without coordinates (restaurants named by the AI, experiences…) fill whatever time is left.
  for (const f of other) {
    const day = open.filter((d) => left.get(d)! >= f.visitMin).sort((a, b) => left.get(b)! - left.get(a)!)[0]
    assign.set(f.id, day)
    if (day) takeTime(day, f)
  }
  for (const f of free) if (!assign.has(f.id)) assign.set(f.id, undefined)
  return { assign }
}

function distTo(group: Favorite[], f: Favorite) {
  const c = centroid(group.filter((g) => g.lat != null) as (Favorite & LatLon)[])
  return c ? haversineM(c, f as LatLon) : 0
}

function kMeans<T extends LatLon>(pts: T[], k: number): T[][] {
  // Farthest-first seeding is deterministic, so the same favourites always give the same plan.
  const seeds: LatLon[] = [centroid(pts)!]
  seeds[0] = pts.reduce((best, p) => (haversineM(p, seeds[0]) > haversineM(best, seeds[0]) ? p : best), pts[0])
  while (seeds.length < k) {
    seeds.push(pts.reduce((best, p) => (minDist(p, seeds) > minDist(best, seeds) ? p : best), pts[0]))
  }
  let groups: T[][] = []
  for (let iter = 0; iter < 12; iter++) {
    groups = seeds.map(() => [])
    for (const p of pts) {
      let bi = 0
      seeds.forEach((s, i) => {
        if (haversineM(p, s) < haversineM(p, seeds[bi])) bi = i
      })
      groups[bi].push(p)
    }
    groups.forEach((g, i) => {
      if (g.length) seeds[i] = centroid(g)!
    })
  }
  return groups.filter((g) => g.length)
}

const minDist = (p: LatLon, seeds: LatLon[]) => Math.min(...seeds.map((s) => haversineM(p, s)))

/* ------------------------------ Write to plan ------------------------------ */

let rebuilding: Promise<unknown> = Promise.resolve()

/**
 * Rebuilds the favourite-based items of the given days: one walking tour per day, plus items without coordinates.
 * Rebuilds queue up one after another: two at the same time (two quick moves) would each add a tour.
 */
export function applyCityPlan(trip: Trip, city: string, dates: string[], settings: Settings): Promise<void> {
  const run = rebuilding.then(() => rebuildCityPlan(trip, city, dates, settings))
  rebuilding = run.catch(() => undefined)
  return run
}

async function rebuildCityPlan(trip: Trip, city: string, dates: string[], settings: Settings) {
  const tag = plannerTag(city)
  let favs = (await db.favorites.where('tripId').equals(trip.id).toArray()).filter((f) => sameCity(f.city, city))
  let items = await db.items.where('tripId').equals(trip.id).toArray()
  const days = await db.days.where('tripId').equals(trip.id).toArray()

  // What you have touched stays: planned places you marked done or skipped, or booked, are yours now and no longer rebuilt.
  const touched = items.filter((i) => i.planner === tag && dates.includes(i.date) && i.favId && !['planned', 'idea'].includes(i.status)).map((i) => i.id)
  if (touched.length) {
    await adoptPlannerItems(touched)
    favs = (await db.favorites.where('tripId').equals(trip.id).toArray()).filter((f) => sameCity(f.city, city))
    items = await db.items.where('tripId').equals(trip.id).toArray()
  }

  const built: Item[] = []
  for (const date of dates) {
    const day = days.find((d) => d.date === date)
    const dayItems = items.filter((i) => i.date === date && i.planner !== tag)

    // Places your plan already has (the itinerary's own "Visit the castle") are linked, not added a second time.
    let mine = favs.filter((f) => scheduled(f) && f.date === date)
    for (const f of mine) {
      const match = dayItems.find((i) => matchesPlace(i, f))
      if (match) {
        await db.favorites.update(f.id, { itemId: match.id, pinned: true })
        f.itemId = match.id
      }
    }
    mine = mine.filter((f) => !f.itemId)

    const cityDays = days.filter((d) => sameCity(d.city, city)).map((d) => d.date).sort()
    const arriving = arrivalTest(city, day, date === cityDays[0])
    const startTime = day?.walkStartTime ?? firstFreeSlot(dayItems, arriving)
    let order = dayItems.reduce((m, i) => Math.max(m, i.order), -1) + 1
    const geo = mine.filter((f) => f.lat != null && f.lon != null && !isDayTrip(f))
    const places = geo.map((f) => ({ id: f.id, name: f.name, lat: f.lat!, lon: f.lon!, category: f.category, visitMin: f.visitMin }))
    if (geo.length) {
      const stay = items.find((i) => i.kind === 'stay' && i.date <= date && date < addDays(i.date, i.nights ?? 1) && i.location?.lat != null)
      const start: Place =
        day?.walkStart?.lat != null
          ? day.walkStart
          : stay?.location?.lat != null
            ? { ...stay.location, name: stay.title }
            : day?.lat != null
              ? { name: `${city} centre`, lat: day.lat, lon: day.lon }
              : { name: geo[0].name, lat: geo[0].lat, lon: geo[0].lon }
      const s = { lat: start.lat!, lon: start.lon! }
      const roundTrip = !!day?.walkRoundTrip
      const stops = optimiseOrder(s, places, roundTrip)
      const pref = day?.getAround ?? settings.getAround ?? 'transit'
      const walkMax = settings.walkMaxMin ?? DEFAULT_WALK_MAX_MIN

      // Time runs through the day: leave the start, travel, visit, travel… and step around anything fixed (booked tickets, lunch).
      const fixed = fixedWindows(dayItems)
      let t = hhmmToMin(startTime)
      let prev: LatLon = s
      let prevName = start.name
      // Starting after something already planned that morning (and no start place chosen): leave from there, not from the hotel.
      const before = day?.walkStart ? undefined : [...fixed].filter((w) => w.at && w.e <= t).sort((x, y) => y.e - x.e)[0]
      if (before?.at) {
        prev = before.at
        prevName = before.title
      }
      const slots = await layoutStops(stops, { t, at: prev, name: prevName }, fixed, pref, walkMax, settings.walkSpeedKmh, departureCutoff(dayItems, t, arriving))
      stops.forEach((f, n) => {
        const slot = slots[n]
        if (!slot) {
          built.push({ id: uid(), tripId: trip.id, date, kind: f.category === 'food' ? 'meal' : 'activity', title: f.name, location: { name: f.name, lat: f.lat, lon: f.lon }, status: 'idea', order: order++, planner: tag, favId: f.id, notes: 'No time left before you leave: move it to another day in the City planner.' })
          return
        }
        const { from, to, leg } = slot
        built.push({
          id: uid(),
          tripId: trip.id,
          date,
          kind: f.category === 'food' ? 'meal' : 'activity',
          title: f.name,
          startTime: minToHHMM(Math.min(from, 1439)),
          endTime: minToHHMM(Math.min(to, 1439)),
          location: { name: f.name, lat: f.lat, lon: f.lon },
          status: 'planned',
          order: order++,
          planner: tag,
          favId: f.id,
          legIn: leg,
        })
      })
      const lastN = slots.map((x, n) => (x ? n : -1)).filter((n) => n >= 0).pop()
      if (lastN != null) {
        t = slots[lastN]!.to
        prev = stops[lastN]
        prevName = stops[lastN].name
      }
      if (roundTrip) {
        const leg = { ...(await planLeg(prev, s, pref, walkMax, settings.walkSpeedKmh)), fromName: prevName }
        built.push({
          id: uid(),
          tripId: trip.id,
          date,
          kind: 'note',
          title: `Back to ${start.name}`,
          startTime: minToHHMM(Math.min(t + leg.minutes, 1439)),
          status: 'planned',
          order: order++,
          location: start,
          planner: tag,
          legIn: leg,
        })
      }
    }
    for (const f of mine.filter((f) => !geo.includes(f))) {
      built.push({
        id: uid(),
        tripId: trip.id,
        date,
        kind: f.category === 'food' ? 'meal' : 'activity',
        title: f.name,
        location: { name: f.name, lat: f.lat, lon: f.lon },
        status: 'idea',
        order: order++,
        notes: f.notes,
        planner: tag,
        favId: f.id,
      })
    }
  }

  await db.transaction('rw', db.items, async () => {
    const old = items.filter((i) => i.planner === tag && dates.includes(i.date))
    await db.items.bulkDelete(old.map((i) => i.id))
    await db.items.bulkAdd(built)
  })
  await touchTrip(trip.id)
}

/* ------------------------------ Timing a day ------------------------------ */

interface Window {
  s: number
  e: number
  at?: LatLon
  title: string
}

/** The fixed parts of a day (timed items that are not the planner's): places are fitted around them. */
const JOURNEYS = new Set(['flight', 'train', 'bus', 'ferry', 'car', 'drive'])

/**
 * Is this journey how you arrive in the day's city (rather than how you leave it)? Its destination is the city (by
 * coordinates or name), its start is elsewhere, or, when nothing says, it is the first day in that city.
 */
export function arrivalTest(city: string | undefined, day: Day | undefined, firstDayInCity: boolean) {
  const nearCity = (p?: Place) =>
    p?.lat != null && p.lon != null && day?.lat != null && day.lon != null ? haversineM({ lat: p.lat, lon: p.lon }, { lat: day.lat, lon: day.lon }) < 40000 : undefined
  const named = (p?: Place) => (city && p?.name ? p.name.toLowerCase().includes(city.trim().toLowerCase()) : undefined)
  return (i: Item) => nearCity(i.to) ?? named(i.to) ?? (nearCity(i.from) === true || named(i.from) === true ? false : firstDayInCity)
}

/** When the day's sightseeing has to end: before the first journey that leaves after it starts (the flight home, the train on). */
function departureCutoff(dayItems: Item[], startMin: number, arriving: (i: Item) => boolean): number | undefined {
  const leave = dayItems
    .filter((i) => i.startTime && !i.planner && i.status !== 'skipped' && JOURNEYS.has(i.kind) && !arriving(i) && hhmmToMin(i.startTime) > startMin)
    .sort((a, b) => a.startTime!.localeCompare(b.startTime!))[0]
  return leave ? hhmmToMin(leave.startTime!) - (leave.kind === 'flight' ? 120 : 30) : undefined
}

function fixedWindows(dayItems: Item[]): Window[] {
  return dayItems
    .filter((i) => i.startTime && i.status !== 'skipped' && i.kind !== 'stay')
    .map((i) => {
      const at = i.location?.lat != null && i.location.lon != null ? { lat: i.location.lat, lon: i.location.lon } : i.walk?.stops[0]
      // Something with a time but no length (a taxi, a meal) still takes a moment: half an hour.
      return { s: hhmmToMin(i.startTime!), e: i.endTime ? hhmmToMin(i.endTime) : hhmmToMin(i.startTime!) + (itemMinutes(i) || 30), at, title: i.title }
    })
    .sort((x, y) => x.s - y.s)
}

/**
 * Lays places out one after the other from a starting time and place: travel there, visit, travel on. When something
 * fixed is in the way, the place goes after it and is reached from where that fixed thing is.
 */
async function layoutStops(
  stops: { lat?: number; lon?: number; name: string; visitMin: number; notBefore?: number }[],
  from: { t: number; at?: LatLon; name: string },
  fixed: Window[],
  pref: GetAround,
  walkMax: number,
  speedKmh: number,
  cutoff = 24 * 60,
): Promise<({ from: number; to: number; leg?: Leg } | undefined)[]> {
  const out: ({ from: number; to: number; leg?: Leg } | undefined)[] = []
  let t = from.t
  let prev = from.at
  let prevName = from.name
  for (const f of stops) {
    // Something without a place (lunch, "free time") just follows on: no travel to work out.
    const here = f.lat != null && f.lon != null ? { lat: f.lat, lon: f.lon } : undefined
    let leg: Leg | undefined = here && prev ? { ...(await planLeg(prev, here, pref, walkMax, speedKmh)), fromName: prevName } : undefined
    let start = Math.max(t + (leg?.minutes ?? 0), f.notBefore ?? 0)
    for (const w of fixed) {
      if (!(start < w.e && start + f.visitMin > w.s)) continue
      if (w.at && here) leg = { ...(await planLeg(w.at, here, pref, walkMax, speedKmh)), fromName: w.title }
      start = w.e + (w.at && here ? leg!.minutes : 0)
    }
    if (start + f.visitMin > cutoff) {
      out.push(undefined) // doesn't fit before you leave: stays on the day as an idea without a time
      continue
    }
    out.push({ from: start, to: start + f.visitMin, leg })
    t = start + f.visitMin
    if (here) {
      prev = here
      prevName = f.name
    }
  }
  return out
}

export interface Retimed {
  moved: number
  shiftMin: number // how much the first moved place changed (negative = earlier)
  undo: () => Promise<void>
}

/**
 * After a place is ticked off or skipped, the planner's places still to come that day move up to fill the gap
 * (or later, if you finished late), keeping their order and length, travelling from where you actually are.
 * Your own timed items don't move; the places are fitted around them.
 */
export async function retimeAfter(changed: Item, settings: Settings, nowMin?: number): Promise<Retimed | undefined> {
  if (!changed.startTime) return undefined
  const dayItems = await db.items.where({ tripId: changed.tripId, date: changed.date }).toArray()
  const days = await db.days.where('tripId').equals(changed.tripId).toArray()
  const after = (i: Item) => i.startTime! > changed.startTime! || (i.startTime === changed.startTime && i.order > changed.order)
  // What can move: anything still to do that isn't a journey, a stay or something booked (tickets with a time stay put).
  const later = dayItems
    .filter((i) => i.id !== changed.id && FLEXIBLE.has(i.kind) && ACTIVE.has(i.status) && !i.bookingRef && i.startTime && after(i))
    .sort((a, b) => a.startTime!.localeCompare(b.startTime!) || a.order - b.order)
  const laterIds = new Set(later.map((i) => i.id))
  if (!later.length) return undefined

  const at = (i?: Item) => (i?.location?.lat != null && i.location.lon != null ? { lat: i.location.lat, lon: i.location.lon } : undefined)
  // Where you are and when you're free: the last place with a location before the next items, if the changed one has none.
  const lastPlaceBefore = dayItems.filter((i) => i.id !== changed.id && i.status !== 'skipped' && i.startTime && i.startTime <= changed.startTime! && at(i)).sort((a, b) => b.startTime!.localeCompare(a.startTime!))[0]
  let start: { t: number; at?: LatLon; name: string } | undefined
  if (changed.status === 'done') {
    const end = changed.endTime ? hhmmToMin(changed.endTime) : hhmmToMin(changed.startTime) + itemMinutes(changed)
    start = at(changed) ? { t: nowMin ?? end, at: at(changed)!, name: changed.title } : { t: nowMin ?? end, at: at(lastPlaceBefore), name: lastPlaceBefore?.title ?? '' }
  } else {
    // Skipped: leave from where you were before it, when you would have left for it.
    const g = changed.legIn?.geometry
    const t = hhmmToMin(changed.startTime) - (changed.legIn?.minutes ?? 0)
    if (g?.length) start = { t, at: { lat: g[0][1], lon: g[0][0] }, name: changed.legIn!.fromName ?? 'the previous place' }
    else {
      const prev = dayItems.filter((i) => i.id !== changed.id && i.status !== 'skipped' && i.startTime && i.startTime < changed.startTime! && at(i)).sort((a, b) => b.startTime!.localeCompare(a.startTime!))[0]
      if (prev) start = { t: prev.endTime ? hhmmToMin(prev.endTime) : t, at: at(prev)!, name: prev.title }
      else start = { t: hhmmToMin(changed.startTime), name: '' }
    }
    if (start && nowMin != null) start.t = Math.max(start.t, nowMin)
  }
  if (!start) return undefined

  const day = days.find((d) => d.date === changed.date)
  const pref = day?.getAround ?? settings.getAround ?? 'transit'
  const fixed = fixedWindows(dayItems.filter((i) => !laterIds.has(i.id) && i.id !== changed.id && i.status !== 'done'))
  const cityDays = days.filter((d) => sameCity(d.city, day?.city)).map((d) => d.date).sort()
  const arriving = arrivalTest(day?.city, day, changed.date === cityDays[0])
  // Close the gap that opened, not every gap of the day: nothing moves up by more than the time freed
  // (the skipped visit and the trip to it, or how early you finished); finishing late pushes things back as needed.
  const length = (i: Item) => (i.endTime ? Math.max(0, hhmmToMin(i.endTime) - hhmmToMin(i.startTime!)) : itemMinutes(i) || 30)
  const plannedEnd = hhmmToMin(changed.startTime) + length(changed)
  const freed = changed.status === 'skipped' ? length(changed) + (changed.legIn?.minutes ?? 0) : nowMin != null ? plannedEnd - nowMin : 0
  const stops = later.map((i) => ({
    ...at(i),
    name: i.title,
    visitMin: length(i),
    notBefore: hhmmToMin(i.startTime!) - freed,
  }))
  const slots = await layoutStops(stops, start, fixed, pref, settings.walkMaxMin ?? DEFAULT_WALK_MAX_MIN, settings.walkSpeedKmh, departureCutoff(dayItems.filter((i) => i.id !== changed.id), start.t, arriving))
  const updates = later
    .flatMap((i, n) => {
      const slot = slots[n]
      return slot ? [{ i, startTime: minToHHMM(Math.min(slot.from, 1439)), endTime: i.endTime ? minToHHMM(Math.min(slot.to, 1439)) : undefined, legIn: slot.leg ?? i.legIn }] : []
    })
    .filter((u) => u.startTime !== u.i.startTime || u.endTime !== u.i.endTime || u.legIn?.fromName !== u.i.legIn?.fromName)
  if (!updates.length) return undefined
  await db.items.bulkUpdate(updates.map((u) => ({ key: u.i.id, changes: { startTime: u.startTime, endTime: u.endTime, legIn: u.legIn } })))
  await touchTrip(changed.tripId)
  const first = updates[0]
  return {
    moved: updates.length,
    shiftMin: hhmmToMin(first.startTime) - hhmmToMin(first.i.startTime!),
    undo: async () => {
      await db.items.bulkUpdate(updates.map((u) => ({ key: u.i.id, changes: { startTime: u.i.startTime, endTime: u.i.endTime, legIn: u.i.legIn } })))
      await touchTrip(changed.tripId)
    },
  }
}

/* ------------------------------ Keeping it consistent ------------------------------ */

const ACTIVE = new Set(['planned', 'idea'])
const FLEXIBLE = new Set(['activity', 'meal', 'walk', 'note'])

/**
 * The wishlist, the days and the plan items must tell the same story. This repairs whatever another change left behind
 * (a day that moved to another city, a shorter trip, a day replanned by the chatbot, an item moved or deleted by hand,
 * an edit synced from another device):
 * - a wishlist place linked to a plan item follows that item (same day); if the item is gone it goes back to the backups;
 * - a place planned on a day that is no longer in its city (or in the trip) goes back to the backups;
 * - items the City planner built for a place that is no longer on that day are removed from the plan;
 * - planner items you booked, ticked off or skipped become yours;
 * - days that should show wishlist places but have none yet (or still have an old one-block walk) are rebuilt.
 * Running it again changes nothing. It returns the names of places sent back because their day changed city.
 */
export function reconcileTrip(tripId: string): Promise<string[]> {
  const run = rebuilding.then(() => reconcileNow(tripId))
  rebuilding = run.catch(() => undefined)
  return run
}

async function reconcileNow(tripId: string): Promise<string[]> {
  const trip = await db.trips.get(tripId)
  if (!trip) return []
  const [favs, items, days] = await Promise.all([
    db.favorites.where('tripId').equals(tripId).toArray(),
    db.items.where('tripId').equals(tripId).toArray(),
    db.days.where('tripId').equals(tripId).toArray(),
  ])
  const inTrip = (d: string) => d >= trip.startDate && d <= trip.endDate
  const cityDayCache = new Map<string, Set<string>>()
  const cityDays = (city: string) => {
    const k = city.trim().toLowerCase()
    if (!cityDayCache.has(k)) cityDayCache.set(k, new Set(days.filter((d) => sameCity(d.city, city) && inTrip(d.date)).map((d) => d.date)))
    return cityDayCache.get(k)!
  }
  const itemById = new Map(items.map((i) => [i.id, i]))
  const favChanges = new Map<string, Partial<Favorite>>()
  const change = (f: Favorite, c: Partial<Favorite>) => {
    favChanges.set(f.id, { ...favChanges.get(f.id), ...c })
    Object.assign(f, c)
  }
  const released: string[] = []

  // Planner items you have acted on are yours from now on.
  const touched = items.filter((i) => i.planner && i.favId && !ACTIVE.has(i.status)).map((i) => i.id)

  for (const f of favs) {
    if (f.itemId) {
      const it = itemById.get(f.itemId)
      if (!it) change(f, { itemId: undefined, date: undefined, pinned: false })
      else if (it.date !== f.date) change(f, { date: it.date, pinned: true })
      continue
    }
    if (f.date && !cityDays(f.city).has(f.date) && !touched.some((id) => itemById.get(id)?.favId === f.id)) {
      change(f, { date: undefined, pinned: false })
      released.push(f.name)
    }
  }

  const favById = new Map(favs.map((f) => [f.id, f]))
  const remove = new Set<string>()
  const dirty = new Map<string, { city: string; dates: Set<string> }>()
  const markDirty = (city: string, date: string) => {
    const k = city.trim().toLowerCase()
    if (!dirty.has(k)) dirty.set(k, { city, dates: new Set() })
    dirty.get(k)!.dates.add(date)
  }
  for (const it of items) {
    if (!it.planner || touched.includes(it.id)) continue
    if (it.favId) {
      const f = favById.get(it.favId)
      if (!f || f.itemId || f.date !== it.date || !cityDays(f.city).has(it.date)) remove.add(it.id)
    } else if (it.kind === 'walk') {
      // A tour from the earlier version (one block for the whole day): rebuilt as one item per place.
      remove.add(it.id)
      const city = days.find((d) => d.date === it.date)?.city
      if (city && it.planner === plannerTag(city)) markDirty(city, it.date)
    }
  }
  // "Back to the hotel" notes go when their day has no other planner item left.
  for (const it of items) {
    if (!it.planner || it.favId || it.kind === 'walk' || remove.has(it.id)) continue
    if (!items.some((o) => o.id !== it.id && o.planner === it.planner && o.date === it.date && o.favId && !remove.has(o.id))) remove.add(it.id)
  }

  // Places due on a coming day that have nothing on the plan yet.
  const now = today()
  for (const f of favs) {
    if (!f.date || f.itemId || f.date < now || !cityDays(f.city).has(f.date)) continue
    const has = items.some((i) => i.favId === f.id && i.date === f.date && !remove.has(i.id))
    if (!has) markDirty(f.city, f.date)
  }

  const wrote = favChanges.size > 0 || remove.size > 0 || touched.length > 0
  if (favChanges.size || remove.size) {
    await db.transaction('rw', [db.favorites, db.items], async () => {
      if (favChanges.size) await db.favorites.bulkUpdate([...favChanges].map(([key, changes]) => ({ key, changes })))
      if (remove.size) await db.items.bulkDelete([...remove])
    })
  }
  if (touched.length) await adoptPlannerItems(touched)
  if (dirty.size) {
    const settings = await getSettings()
    for (const { city, dates } of dirty.values()) await rebuildCityPlan(trip, city, [...dates].filter((d) => cityDays(city).has(d)), settings)
  } else if (wrote) await touchTrip(tripId)
  return released
}

/** Start the walk after whatever is already planned in the morning (or after arriving), never before 09:30. */
function firstFreeSlot(dayItems: Item[], arriving: (i: Item) => boolean): string {
  let t = hhmmToMin('09:30')
  for (const i of [...dayItems].sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))) {
    if (!i.startTime || i.status === 'skipped' || i.kind === 'stay') continue
    const s = hhmmToMin(i.startTime)
    const e = i.endTime ? hhmmToMin(i.endTime) : s + itemMinutes(i)
    const journey = JOURNEYS.has(i.kind)
    if (journey && !arriving(i)) continue // leaving later that day doesn't push the start: it ends the day instead
    if (s <= t + 30 || (journey && s < hhmmToMin('15:00'))) t = Math.max(t, e + (journey ? 60 : 0))
  }
  return minToHHMM(Math.min(t, hhmmToMin('17:00')))
}

/** The dates of the trip whose city is `city`. */
export function cityDates(days: Day[], city: string) {
  return days.filter((d) => sameCity(d.city, city)).map((d) => d.date).sort()
}
