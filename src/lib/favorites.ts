// Favourites per city and "Plan my days": spread them over the days you spend in that city,
// grouped by neighbourhood and sized to your pace. Runs entirely in the browser.

import { db, touchTrip } from '../db'
import type { Day, Favorite, Item, Settings, Trip, TripStyle } from '../types'
import { POI_CATEGORIES, walkingRoute } from './apis'
import { addDays, hhmmToMin, minToHHMM } from './dates'
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
  const favs = (await db.favorites.where('tripId').equals(trip.id).toArray()).filter((f) => sameCity(f.city, city))
  const items = await db.items.where('tripId').equals(trip.id).toArray()
  const days = await db.days.where('tripId').equals(trip.id).toArray()
  const speed = (settings.walkSpeedKmh * 1000) / 3600

  const built: Item[] = []
  await Promise.all(
    dates.map(async (date) => {
      const mine = favs.filter((f) => scheduled(f) && f.date === date)
      const day = days.find((d) => d.date === date)
      const dayItems = items.filter((i) => i.date === date && i.planner !== tag)
      const startTime = day?.walkStartTime ?? firstFreeSlot(dayItems)
      let order = dayItems.reduce((m, i) => Math.max(m, i.order), -1) + 1

      const geo = mine.filter((f) => f.lat != null && f.lon != null && !isDayTrip(f))
      if (geo.length) {
        const stay = items.find((i) => i.kind === 'stay' && i.date <= date && date < addDays(i.date, i.nights ?? 1) && i.location?.lat != null)
        const start =
          day?.walkStart?.lat != null
            ? day.walkStart
            : stay?.location?.lat != null
              ? { ...stay.location, name: stay.title }
              : day?.lat != null ? { name: `${city} centre`, lat: day.lat, lon: day.lon } : { name: geo[0].name, lat: geo[0].lat, lon: geo[0].lon }
        const s = { lat: start.lat!, lon: start.lon! }
        const roundTrip = !!day?.walkRoundTrip
        const stops = optimiseOrder(
          s,
          geo.map((f) => ({ id: f.id, name: f.name, lat: f.lat!, lon: f.lon!, category: f.category, visitMin: f.visitMin, wikipedia: f.wikipedia, wikidata: f.wikidata })),
          roundTrip,
        )
        const pts = [s, ...stops, ...(roundTrip ? [s] : [])]
        let walk: Item['walk']
        try {
          const r = await walkingRoute(pts)
          walk = { start, roundTrip, stops, geometry: r.geometry, legs: r.legs.map((l) => ({ distanceM: l.distanceM, durationS: l.distanceM / speed })), distanceM: r.distanceM, walkS: r.distanceM / speed, routedBy: 'osrm' }
        } catch {
          const legs = pts.slice(1).map((p, i) => {
            const d = haversineM(pts[i], p) * 1.3
            return { distanceM: d, durationS: d / speed }
          })
          const total = legs.reduce((a, l) => a + l.distanceM, 0)
          walk = { start, roundTrip, stops, geometry: pts.map((p) => [p.lon, p.lat]), legs, distanceM: total, walkS: total / speed, routedBy: 'straight-line' }
        }
        const minutes = walk.walkS / 60 + stops.reduce((a, x) => a + x.visitMin, 0)
        built.push({
          id: uid(),
          tripId: trip.id,
          date,
          kind: 'walk',
          title: `${city}: ${stops.slice(0, 2).map((x) => x.name).join(' & ')}${stops.length > 2 ? ` +${stops.length - 2}` : ''}`,
          startTime,
          endTime: minToHHMM(hhmmToMin(startTime) + minutes),
          location: { name: stops[0].name, lat: stops[0].lat, lon: stops[0].lon },
          status: 'planned',
          order: order++,
          walk,
          planner: tag,
          notes: 'Built from your wishlist.',
        })
      }
      for (const f of mine.filter((f) => !geo.includes(f))) {
        built.push({
          id: uid(),
          tripId: trip.id,
          date,
          kind: isDayTrip(f) ? 'activity' : f.category === 'food' ? 'meal' : 'activity',
          title: f.name,
          location: { name: f.name, lat: f.lat, lon: f.lon },
          status: 'idea',
          order: order++,
          notes: f.notes,
          planner: tag,
        })
      }
    }),
  )

  await db.transaction('rw', db.items, async () => {
    const old = items.filter((i) => i.planner === tag && dates.includes(i.date))
    await db.items.bulkDelete(old.map((i) => i.id))
    await db.items.bulkAdd(built)
  })
  await touchTrip(trip.id)
}

/** Start the walk after whatever is already planned in the morning (or after arriving), never before 09:30. */
function firstFreeSlot(dayItems: Item[]): string {
  let t = hhmmToMin('09:30')
  for (const i of dayItems) {
    if (!i.startTime) continue
    const s = hhmmToMin(i.startTime)
    const e = i.endTime ? hhmmToMin(i.endTime) : s + itemMinutes(i)
    const arrival = ['flight', 'train', 'ferry', 'bus', 'car', 'drive'].includes(i.kind)
    if (s <= t + 30 || (arrival && s < hhmmToMin('15:00'))) t = Math.max(t, e + (arrival ? 60 : 0))
  }
  return minToHHMM(Math.min(t, hhmmToMin('17:00')))
}

/** The dates of the trip whose city is `city`. */
export function cityDates(days: Day[], city: string) {
  return days.filter((d) => sameCity(d.city, city)).map((d) => d.date).sort()
}
