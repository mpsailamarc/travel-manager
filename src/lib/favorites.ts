// Favourites per city and "Plan my days": spread them over the days you spend in that city,
// grouped by neighbourhood and sized to your pace. Runs entirely in the browser.

import { adoptPlannerItems, db, getSettings, touchTrip } from '../db'
import type { Day, Favorite, GetAround, Item, Leg, Place, Settings, Trip, TripStyle } from '../types'
import { POI_CATEGORIES } from './apis'
import { matchesPlace } from './duplicates'
import { openingWindow } from './hours'
import { cityIn, trustedPlace } from './cities'
import { DEFAULT_WALK_MAX_MIN, getAroundFor, planLeg } from './legs'
import { sunClock } from './sun'
import { midnight, transportSpan, tzAt, zoneOfDate } from './tz'
import { tidyStays } from './stays'
import { addMissingHomeLegs, isHome, isHomeTransfer } from './home'
import { addDays, hhmmToMin, minToHHMM, today } from './dates'
import { centroid, haversineM, type LatLon } from './geo'
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

/**
 * The city in a day's city name, without what chatbots add to it: "London, United Kingdom", "Rome (Trastevere)",
 * "Sydney (overnight flight)", "Santiago → Sydney (return)", "Valparaíso / Santiago", "Rome central" are London, Rome,
 * Sydney, Santiago, Valparaíso and Rome.
 */
export function cityBase(name: string): string {
  const n = name
    .split(/\s*[([]/)[0]
    .split(/\s+(?:→|->|–|—|-|\|)\s+|\s*\/\s*|\s*,\s*/)[0]
    .replace(/\s+(?:city\s+)?(?:central|centre|center|downtown|old town|city|area|district|region)$/i, '')
    .trim()
  return n || name.trim()
}

/**
 * One name per city across the trip's days: each day's city without its extras, and a name that starts with another
 * city's name nearby ("Rome Trastevere" next to "Rome", within 30 km) joins that city. Returns old name → new name for
 * the days whose name changes.
 */
export function canonicalCities(days: Day[]): Map<string, string> {
  const groups: { name: string; lat?: number; lon?: number }[] = []
  const of = new Map<string, { name: string }>()
  const near = (d: Day, g: { lat?: number; lon?: number }) => d.lat == null || d.lon == null || g.lat == null || g.lon == null || haversineM({ lat: d.lat, lon: d.lon }, { lat: g.lat, lon: g.lon }) < 30_000
  const starts = (a: string, b: string) => a.toLowerCase().startsWith(`${b.toLowerCase()} `)
  for (const d of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!d.city) continue
    const base = cityBase(d.city)
    let g = groups.find((x) => sameCity(x.name, base)) ?? groups.find((x) => (starts(base, x.name) || starts(x.name, base)) && near(d, x))
    if (!g) groups.push((g = { name: base, lat: d.lat, lon: d.lon }))
    else if (base.length < g.name.length) g.name = base
    of.set(d.city, g)
  }
  const out = new Map<string, string>()
  for (const [old, g] of of) if (old !== g.name) out.set(old, g.name)
  return out
}

/** A plan item turned into a backup idea: its place, length and notes kept, ready to go back on a day. */
export function favFromItem(it: Item, city: string): Favorite {
  const own = it.startTime && it.endTime ? hhmmToMin(it.endTime) - hhmmToMin(it.startTime) : 0
  const category = it.category && CATEGORY_META[it.category] ? it.category : it.kind === 'meal' ? 'food' : 'attraction'
  return {
    id: uid(),
    tripId: it.tripId,
    city,
    name: it.title,
    lat: it.location?.lat,
    lon: it.location?.lon,
    category,
    visitMin: own > 0 ? own : categoryMeta(category).visitMin,
    source: 'manual',
    notes: it.notes,
    openingHours: it.hours,
    addedAt: Date.now(),
  }
}

/**
 * Takes something off its day and keeps it as a backup idea of the day's city: a wishlist place loses its day (and the
 * plan item made for it goes), anything else becomes a backup idea. Returns the city, or nothing when the day has none.
 */
export async function sendToBackup(it: Item): Promise<string | undefined> {
  const [days, favs, trip] = await Promise.all([db.days.where('tripId').equals(it.tripId).toArray(), db.favorites.where('tripId').equals(it.tripId).toArray(), db.trips.get(it.tripId)])
  const city = days.find((d) => d.date === it.date)?.city ?? trip?.cities[0]
  if (!city) return undefined
  const fav = favs.find((f) => f.id === it.favId || f.itemId === it.id)
  await db.transaction('rw', [db.items, db.favorites], async () => {
    if (fav) await db.favorites.update(fav.id, { date: undefined, pinned: false, itemId: undefined })
    else await db.favorites.add(favFromItem(it, city))
    await db.items.delete(it.id)
  })
  await touchTrip(it.tripId)
  return city
}
export const plannerTag = (city: string) => `fav:${city.trim().toLowerCase()}`

/** A visit time in minutes. Chatbots sometimes answer in hours ("1.5"): nothing worth a visit takes under 10 minutes. */
export const visitMinutes = (v?: number) => (v == null || v <= 0 ? undefined : v < 10 ? Math.round(v * 60) : Math.round(v))

/** Favourites that belong to a plan day as part of its rebuilt walk (not the ones added on the day itself). */
const scheduled = (f: Favorite) => !!f.date && !f.itemId

/* ------------------------------ Day capacity ------------------------------ */

// Sightseeing minutes per day, out of a 9:00–21:00 day: relaxed about a third, balanced half, packed about 90%;
// all out fills a 7:00–midnight day with no breaks.
const PACE_MIN: Record<TripStyle, number> = { relaxed: 240, balanced: 360, packed: 650, intense: 900 }
// When a day starts and how late it may run: all out starts at 7:00 and goes on until midnight.
const DAY_FROM = (s: TripStyle) => (s === 'intense' ? 7 * 60 : 9 * 60 + 30)
const DAY_UNTIL = (s: TripStyle) => (s === 'intense' ? 24 * 60 : 22 * 60)
const STOP_OVERHEAD = 15 // minutes of walking/queuing per stop, before the real route is known

function itemMinutes(it: Item): number {
  if (it.startTime && it.endTime) return Math.max(0, (hhmmToMin(it.endTime) - hhmmToMin(it.startTime) + 1440) % 1440)
  switch (it.kind) {
    case 'flight':
      return 300
    case 'train':
    case 'ferry':
      return 180
    case 'car':
      return 30 // picking up or returning a rental car
    case 'drive': {
      // A drive without an end time: the distance at about 60 km/h on the road, when both ends are known; else an hour and a half.
      const a = it.from?.lat != null && it.from.lon != null ? { lat: it.from.lat, lon: it.from.lon } : undefined
      const b = it.to?.lat != null && it.to.lon != null ? { lat: it.to.lat, lon: it.to.lon } : undefined
      return a && b ? Math.max(20, Math.round(((haversineM(a, b) * 1.3) / 1000 / 60) * 60)) : 90
    }
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

    // Everything that can move goes through the same scheduler as "Optimise this day": your wishlist places, plus the day's own
    // items that aren't kept in place (📌 locked, booked, journeys, stays). The rest stays where it is and the day fits around it.
    const ownFlex = dayItems.filter(isMovable)
    const ownIds = new Set(ownFlex.map((i) => i.id))
    const fixedItems = dayItems.filter((i) => !ownIds.has(i.id))
    let order = dayItems.reduce((m, i) => Math.max(m, i.order), -1) + 1
    const geo = mine.filter((f) => f.lat != null && f.lon != null && !isDayTrip(f))
    const movable: Movable[] = [
      ...geo.map((f) => ({ key: f.id, name: f.name, lat: f.lat!, lon: f.lon!, visitMin: f.visitMin, ...hoursOf({ title: f.name, kind: 'activity', category: f.category, hours: f.openingHours }, date) })),
      ...ownFlex.map((i) => ownMovable(i, favs)),
    ]
    const ownUpdates: { key: string; changes: Partial<Item> }[] = []
    if (movable.length) {
      const plan = await scheduleDay({ trip, date, city, day, days, items, settings, arriving }, fixedItems, movable)
      for (const f of geo) {
        const slot = plan.slots.get(f.id)
        if (!slot) {
          built.push({ id: uid(), tripId: trip.id, date, kind: f.category === 'food' ? 'meal' : 'activity', title: f.name, location: { name: f.name, lat: f.lat, lon: f.lon }, status: 'idea', order: order++, planner: tag, favId: f.id, notes: 'No time left that day: move it to another day in the City planner.' })
          continue
        }
        built.push({
          id: uid(),
          tripId: trip.id,
          date,
          kind: f.category === 'food' ? 'meal' : 'activity',
          title: f.name,
          startTime: minToHHMM(Math.min(slot.from, 1439)),
          endTime: minToHHMM(Math.min(slot.to, 1439)),
          location: { name: f.name, lat: f.lat, lon: f.lon },
          status: 'planned',
          order: order++,
          planner: tag,
          favId: f.id,
          legIn: slot.leg,
          category: f.category,
          hours: f.openingHours,
        })
      }
      for (const i of ownFlex) {
        const slot = plan.slots.get(i.id)
        if (slot) ownUpdates.push({ key: i.id, changes: { startTime: minToHHMM(Math.min(slot.from, 1439)), endTime: minToHHMM(Math.min(slot.to, 1439)), legIn: slot.leg, autoTime: true } })
        else if (i.startTime) ownUpdates.push({ key: i.id, changes: { startTime: undefined, endTime: undefined, legIn: undefined, autoTime: undefined } })
      }
    }
    if (ownUpdates.length) await db.items.bulkUpdate(ownUpdates)
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

  // The items built again keep the ids of the ones they replace (the same place on the same day): only real changes are
  // written, so rebuilding a day that hasn't changed changes nothing — and nothing else is set off by it.
  const old = items.filter((i) => i.planner === tag && dates.includes(i.date))
  const same = (a: Item, b: Item) => a.date === b.date && a.kind === b.kind && (a.favId ? a.favId === b.favId : !b.favId && a.title === b.title)
  const free = [...old]
  for (const b of built) {
    const k = free.findIndex((o) => same(o, b))
    if (k >= 0) b.id = free.splice(k, 1)[0].id
  }
  const sig = (i: Item) => JSON.stringify([i.date, i.kind, i.title, i.startTime, i.endTime, i.status, i.order, i.favId, i.notes, i.legIn?.minutes, i.location?.lat, i.location?.lon])
  const changed = built.filter((b) => {
    const o = old.find((x) => x.id === b.id)
    return !o || sig(o) !== sig(b)
  })
  if (!changed.length && !free.length) return
  await db.transaction('rw', db.items, async () => {
    if (free.length) await db.items.bulkDelete(free.map((i) => i.id))
    if (changed.length) await db.items.bulkPut(changed)
  })
  await touchTrip(trip.id)
}

/**
 * Wishlist places your plan already has on one of the city's days (the itinerary's "Tower of London") are linked to that
 * item and day, so "Plan my days" times the item instead of adding the place a second time on another day.
 */
export async function linkWishlistToPlan(tripId: string, city: string): Promise<number> {
  const favs = (await db.favorites.where('tripId').equals(tripId).toArray()).filter((f) => sameCity(f.city, city) && !f.itemId)
  const days = await db.days.where('tripId').equals(tripId).toArray()
  const dates = new Set(cityDates(days, city))
  const items = (await db.items.where('tripId').equals(tripId).toArray()).filter((i) => !i.planner && dates.has(i.date))
  const taken = new Set((await db.favorites.where('tripId').equals(tripId).toArray()).map((f) => f.itemId).filter(Boolean))
  let n = 0
  for (const f of favs) {
    const match = items.find((i) => !taken.has(i.id) && matchesPlace(i, f))
    if (!match) continue
    taken.add(match.id)
    await db.favorites.update(f.id, { itemId: match.id, date: match.date, pinned: true })
    n++
  }
  return n
}

/* ------------------------------ The day scheduler ------------------------------ */

const KEPT_KINDS = new Set(['flight', 'train', 'bus', 'ferry', 'car', 'drive', 'taxi', 'stay'])

/** Kept where it is when a day is planned or optimised: 📌 locked by you, booked or ticked off, a journey or a stay. */
export function isLocked(i: Item): boolean {
  return !!i.locked || i.status === 'booked' || i.status === 'done' || !!i.bookingRef || KEPT_KINDS.has(i.kind)
}

/** Can planning or optimising move it? Activities, meals, walks and notes still to do that aren't kept in place. */
export function isMovable(i: Item): boolean {
  return FLEXIBLE.has(i.kind) && ACTIVE.has(i.status) && !isLocked(i)
}

export interface Movable {
  key: string
  name: string
  lat?: number
  lon?: number
  visitMin: number
  meal?: boolean
  mealAt?: number // a meal's natural time (lunch 12:00, dinner 19:00), from its name or the time it had
  open?: number // likely opening hours (minutes): planned inside them when possible
  close?: number
}

/** Opening hours as minutes for the scheduler: a place shut that day gets an empty window (it is then planned, but flagged). */
function hoursOf(x: { title: string; kind?: string; category?: string; hours?: string }, date: string) {
  const w = openingWindow(x, date)
  return w === 'closed' ? { open: 0, close: 0 } : w ? { open: w.open, close: w.close } : {}
}

/**
 * When something about the sun should start: sunset things so they end half an hour after the sun goes down, sunrise
 * things half an hour before it comes up, night things (night photos, stars) once it's dark, and evening things in the
 * last hour of daylight (at the place, else the day's city). Meals keep their own times.
 */
function sunAt(m: Pick<Movable, 'name' | 'lat' | 'lon' | 'visitMin' | 'meal'>, ctx: Pick<DayContext, 'trip' | 'date' | 'day' | 'days'>): number | undefined {
  if (m.meal) return undefined
  const sunset = /sunset|golden hour|puesta de sol|atardecer|coucher de soleil|tramonto/i.test(m.name)
  const sunrise = !sunset && /sunrise|dawn|amanecer|lever de soleil|alba\b/i.test(m.name)
  const night = !sunset && !sunrise && /\bnight\b|stargaz|\bstars\b|after dark|nocturn/i.test(m.name)
  const evening = !sunset && !sunrise && !night && /\bevening\b/i.test(m.name)
  if (!sunset && !sunrise && !night && !evening) return undefined
  const lat = m.lat ?? ctx.day?.lat
  const lon = m.lon ?? ctx.day?.lon
  const tz = zoneOfDate(ctx.date, { trip: ctx.trip, days: ctx.days }) ?? tzAt(lat, lon)
  const sun = lat != null && lon != null && tz ? sunClock(ctx.date, lat, lon, tz) : undefined
  if (!sun) return undefined
  if (night) return Math.min(sun.set + 45, 23 * 60)
  if (evening) return Math.max(17 * 60, sun.set - 60)
  return Math.max(0, sunset ? sun.set + 30 - m.visitMin : sun.rise - 30)
}

/** Lunch or dinner time for a meal, from its name or the time it was given; breakfast and snacks have none. */
function mealTime(title: string, start?: string): number | undefined {
  if (/dinner|supper|evening/i.test(title)) return 19 * 60
  if (/lunch|brunch/i.test(title)) return 12 * 60
  if (/breakfast|coffee|snack|ice cream|pastel|pastry/i.test(title)) return undefined
  const t = start ? hhmmToMin(start) : undefined
  return t == null ? undefined : t >= 17 * 60 ? 19 * 60 : t >= 11 * 60 && t < 15 * 60 ? 12 * 60 : undefined
}

/** How long a plan item takes: the wishlist place's visit time, its own times, or a sensible default for its kind. */
function ownMovable(i: Item, favs: Favorite[]): Movable {
  const fav = favs.find((f) => f.itemId === i.id || f.id === i.favId)
  const linked = favs.find((f) => f.itemId === i.id || f.id === i.favId)
  const at = i.location?.lat != null && i.location.lon != null ? { lat: i.location.lat, lon: i.location.lon } : i.walk?.stops[0]
  const own = i.startTime && i.endTime ? hhmmToMin(i.endTime) - hhmmToMin(i.startTime) : undefined
  // A visit of a few minutes is a slip (a time squeezed in, or hours read as minutes), not a real length.
  const visitMin =
    own != null && own >= (i.kind === 'note' ? 1 : i.kind === 'meal' ? 20 : 10) ? own : linked ? linked.visitMin : i.walk ? Math.round(i.walk.walkS / 60 + i.walk.stops.reduce((a, x) => a + x.visitMin, 0)) : i.kind === 'meal' ? 60 : i.kind === 'note' ? 30 : /\bshort\b|quick|brief/i.test(i.title) ? 30 : i.kind === 'walk' ? 60 : 90
  return {
    key: i.id,
    name: i.title,
    lat: at?.lat,
    lon: at?.lon,
    visitMin,
    meal: i.kind === 'meal',
    mealAt: i.kind === 'meal' ? mealTime(i.title, i.startTime) : undefined,
    ...hoursOf({ title: i.title, kind: i.kind, category: i.category ?? fav?.category, hours: i.hours ?? fav?.openingHours }, i.date),
  }
}

interface DayContext {
  trip: Trip
  date: string
  city?: string
  day?: Day
  days: Day[]
  items: Item[] // the whole trip (for the night's stay)
  settings: Settings
  arriving: (i: Item) => boolean
}

export interface DayPlan {
  slots: Map<string, { from: number; to: number; leg?: Leg } | undefined>
}

/** A quick travel-time guess (no network) for choosing the order; the real routes come after. */
function guessMin(a: LatLon, b: LatLon, pref: GetAround, walkMax: number, speedKmh: number) {
  const d = haversineM(a, b) * 1.3
  const walk = d / ((speedKmh * 1000) / 60)
  if (pref === 'walk' || walk <= walkMax) return walk
  if (pref === 'car') return d / 1000 // about 60 km/h on the road
  const transit = 10 + d / 300 // 18 km/h
  const taxi = 5 + d / 417 // 25 km/h
  return pref === 'transit' ? transit : pref === 'taxi' ? taxi : Math.min(walk, transit, taxi)
}

/**
 * Plans the movable part of a day around the fixed part. The fixed things (with a place) split the day into stretches;
 * each movable place goes into the stretch where it adds the least travel and still fits, in the order that makes the
 * shortest path between the stretch's two ends. A meal with no place goes in around noon (a second one in the evening),
 * anything else without a place at the end. Then real routes and times are worked out, stepping around what is fixed.
 */
export async function scheduleDay(ctx: DayContext, fixedItems: Item[], movable: Movable[]): Promise<DayPlan> {
  const { trip, date, city, day, items, settings } = ctx
  fixedItems = fixedItems.filter((i) => !leavesLater(i, ctx))
  movable = movable.map((m) => (m.mealAt != null ? m : { ...m, mealAt: sunAt(m, ctx) }))
  const pref = getAroundFor(day, settings, items, date)
  const walkMax = settings.walkMaxMin ?? DEFAULT_WALK_MAX_MIN
  const speed = settings.walkSpeedKmh
  const guess = (a: LatLon, b: LatLon) => guessMin(a, b, pref, walkMax, speed)

  // The day starts where you slept (on a moving day that's last night's hotel, not tonight's).
  const covers = (d: string) => (i: Item) => i.kind === 'stay' && i.date <= d && d < addDays(i.date, i.nights ?? 1) && i.location?.lat != null
  const stay = items.find(covers(addDays(date, -1))) ?? items.find(covers(date))
  const located = movable.filter((m) => m.lat != null && m.lon != null) as (Movable & LatLon)[]
  const startPlace: Place | undefined =
    day?.walkStart?.lat != null
      ? day.walkStart
      : stay?.location?.lat != null
        ? { ...stay.location, name: stay.title }
        : day?.lat != null
          ? { name: `${city ?? trip.name} centre`, lat: day.lat, lon: day.lon }
          : located[0]
            ? { name: located[0].name, lat: located[0].lat, lon: located[0].lon }
            : undefined
  const home = startPlace?.lat != null && startPlace.lon != null ? { lat: startPlace.lat, lon: startPlace.lon } : undefined
  // Where the day ends: tonight's hotel (on a moving day, the new one), so the way back counts; off when turned off for
  // the day. Without a hotel tonight (flying home), it ends wherever the last thing is — or back at the start, if asked.
  // In the day's city: a stay whose nights were written one too many (still "covering" the night after you moved on) isn't it.
  const tonight = items.find((i) => covers(date)(i) && (day?.lat == null || day.lon == null || haversineM(i.location as LatLon, { lat: day.lat, lon: day.lon }) < 50_000))
  const endAt: LatLon | undefined =
    day?.walkRoundTrip === false ? undefined : tonight?.location?.lat != null && tonight.location.lon != null ? { lat: tonight.location.lat, lon: tonight.location.lon } : day?.walkRoundTrip ? home : undefined

  const here = home ?? (day?.lat != null && day.lon != null ? { lat: day.lat, lon: day.lon } : undefined)
  // A flight from the day before that lands today keeps the morning until it's down; the day then starts at the airport.
  const landing = landingOn(ctx)
  const fixed = [...(landing ? [landing] : []), ...fixedWindows(fixedItems, here, ctx.arriving)]
  let startTime = day?.walkStartTime ? hhmmToMin(day.walkStartTime) : dayStart(fixedItems, fixed, here, ctx.arriving, trip.style)
  if (landing && !day?.walkStartTime) startTime = Math.max(startTime, Math.min(landing.e + 60, 23 * 60))
  const cutoff = departureCutoff(fixedItems, startTime, ctx.arriving, date === trip.endDate)
  // A sunset or night outing may run past the pace's usual end (sunset in Paris in July is near 22:00).
  const sunLate = Math.max(0, ...movable.filter((m) => !m.meal && m.mealAt != null).map((m) => m.mealAt! + m.visitMin))
  const dayEnd = cutoff ?? Math.min(24 * 60, Math.max(DAY_UNTIL(trip.style), sunLate))

  // Where you are at the start: the hotel (or chosen start), or wherever something fixed earlier that morning left you.
  let from = { t: startTime, at: home, name: startPlace?.name ?? '' }
  const before = day?.walkStart ? undefined : [...fixed].filter((w) => w.at && w.e <= startTime).sort((x, y) => y.e - x.e)[0]
  if (before?.at) from = { t: startTime, at: before.at, name: before.title }

  // Stretches of free time between fixed things that have a place.
  type Stretch = { s: number; e: number; a?: LatLon; b?: LatLon; seq: (Movable & LatLon)[] }
  const anchors = fixed.filter((w) => w.at && w.e > startTime)
  const stretches: Stretch[] = []
  let cur: { t: number; at?: LatLon } = { t: from.t, at: from.at }
  for (const w of anchors) {
    if (w.s > cur.t) stretches.push({ s: cur.t, e: w.s, a: cur.at, b: w.startAt, seq: [] })
    cur = { t: Math.max(cur.t, w.e), at: w.at }
  }
  stretches.push({ s: cur.t, e: dayEnd, a: cur.at, b: endAt, seq: [] })

  // Walk a stretch in order: travel, wait for opening if early, visit. `late` adds up the minutes past closing time.
  const simulate = (st: Stretch, seq: (Movable & LatLon)[]) => {
    let t = st.s
    let travel = 0
    let late = 0
    let p = st.a
    for (const x of seq) {
      if (p) {
        const g = guess(p, x)
        travel += g
        t += g
      }
      if (x.open != null) t = Math.max(t, x.open)
      t += x.visitMin
      if (x.close != null && t > x.close) late += t - x.close
      p = x
    }
    if (p && st.b) {
      const g = guess(p, st.b)
      travel += g
      t += g
    }
    return { end: t, travel, late }
  }
  const fits = (st: Stretch, seq: (Movable & LatLon)[]) => {
    const r = simulate(st, seq)
    return r.end <= st.e && r.late === 0
  }
  // Travel, with a heavy price on visits that would end after closing (so the order keeps them inside opening hours).
  const travelOnly = (st: Stretch, seq: (Movable & LatLon)[]) => {
    const r = simulate(st, seq)
    return r.travel + r.late * 10
  }

  // Places with opening hours first (they need the daytime), longest visits first: each goes where it adds the least travel
  // among the stretches it still fits in.
  const leftover: (Movable & LatLon)[] = []
  for (const x of [...located].sort((p, q) => (p.close != null ? 0 : 1) - (q.close != null ? 0 : 1) || q.visitMin - p.visitMin)) {
    let best: { st: Stretch; pos: number; cost: number } | undefined
    for (const st of stretches) {
      for (let pos = 0; pos <= st.seq.length; pos++) {
        const seq = [...st.seq.slice(0, pos), x, ...st.seq.slice(pos)]
        if (!fits(st, seq)) continue
        const cost = travelOnly(st, seq) - travelOnly(st, st.seq)
        if (!best || cost < best.cost) best = { st, pos, cost }
      }
    }
    if (best) best.st.seq.splice(best.pos, 0, x)
    else leftover.push(x)
  }
  // What fits nowhere goes where it is least late (and adds least travel), as long as it doesn't run into what's fixed;
  // with a departure to respect it may stay off the day instead.
  for (const x of leftover.splice(0)) {
    let best: { st: Stretch; pos: number; cost: number } | undefined
    for (const st of stretches) {
      const last = st === stretches[stretches.length - 1]
      for (let pos = 0; pos <= st.seq.length; pos++) {
        const seq = [...st.seq.slice(0, pos), x, ...st.seq.slice(pos)]
        if (simulate(st, seq).end > st.e && !(last && cutoff == null)) continue
        const cost = travelOnly(st, seq) - travelOnly(st, st.seq)
        if (!best || cost < best.cost) best = { st, pos, cost }
      }
    }
    if (best) best.st.seq.splice(best.pos, 0, x)
  }

  // Improve the whole assignment: move a place to another spot, or swap two places between stretches, whenever that lowers
  // travel plus time past closing (and never runs into something fixed). A few passes are plenty for a day.
  const overrun = (st: Stretch) => {
    const last = st === stretches[stretches.length - 1]
    const over = simulate(st, st.seq).end - st.e
    // Running into something fixed isn't a matter of degree: the place would really be pushed after it, so it's all but forbidden.
    if (over > 0 && !(last && cutoff == null)) return over * 1000
    const pastMidnight = simulate(st, st.seq).end - 24 * 60
    return pastMidnight > 0 ? pastMidnight * 1000 : over > 0 ? over * 2 : 0
  }
  const total = () => stretches.reduce((sum, st) => sum + travelOnly(st, st.seq) + overrun(st), 0)
  for (let pass = 0; pass < 6; pass++) {
    let best = total()
    let improved = false
    // Relocate
    for (const sa of stretches)
      for (let i = 0; i < sa.seq.length; i++) {
        const x = sa.seq[i]
        sa.seq.splice(i, 1)
        let to: { st: Stretch; pos: number; cost: number } | undefined
        for (const sb of stretches)
          for (let pos = 0; pos <= sb.seq.length; pos++) {
            sb.seq.splice(pos, 0, x)
            const c = total()
            sb.seq.splice(pos, 1)
            if (c + 0.5 < (to?.cost ?? best)) to = { st: sb, pos, cost: c }
          }
        if (to) {
          to.st.seq.splice(to.pos, 0, x)
          best = to.cost
          improved = true
          i = sa.seq.length // this stretch changed: carry on with the next one
        } else sa.seq.splice(i, 0, x)
      }
    // Swap between stretches
    for (let a = 0; a < stretches.length; a++)
      for (let b = a + 1; b < stretches.length; b++) {
        const A = stretches[a].seq
        const B = stretches[b].seq
        for (let i = 0; i < A.length; i++)
          for (let k = 0; k < B.length; k++) {
            ;[A[i], B[k]] = [B[k], A[i]]
            const c = total()
            if (c + 0.5 < best) {
              best = c
              improved = true
            } else [A[i], B[k]] = [B[k], A[i]]
          }
      }
    if (!improved) break
  }

  // Untangle each stretch (2-opt with its two ends fixed).
  for (const st of stretches) {
    let improved = true
    while (improved && st.seq.length > 2) {
      improved = false
      for (let i = 0; i < st.seq.length - 1; i++)
        for (let k = i + 1; k < st.seq.length; k++) {
          const next = [...st.seq.slice(0, i), ...st.seq.slice(i, k + 1).reverse(), ...st.seq.slice(k + 1)]
          if (travelOnly(st, next) + 0.5 < travelOnly(st, st.seq)) {
            st.seq = next
            improved = true
          }
        }
    }
  }

  // One running order. Meals go in at their time of day (lunch around noon, dinner in the evening), and sunset or sunrise
  // things at theirs: one with a place keeps the stretch it was given but moves to that time; one with no place just slots
  // in. Other place-less things go last.
  const timedMeals = new Set(stretches.flatMap((st) => st.seq.filter((x) => x.mealAt != null).map((x) => x.key)))
  const order: Movable[] = stretches.flatMap((st) => st.seq.filter((x) => !timedMeals.has(x.key)))
  const noPlace = movable.filter((m) => m.lat == null || m.lon == null)
  const placelessMeals = noPlace.filter((m) => m.meal || m.mealAt != null).map((m, k) => ({ ...m, mealAt: m.mealAt ?? (m.meal ? (k === 0 ? 12 * 60 : k === 1 ? 19 * 60 : undefined) : undefined) }))
  const rest = noPlace.filter((m) => !m.meal && m.mealAt == null)
  const guessStart = (n: number) => {
    // When the n-th stop of `order` would start, roughly.
    let t = from.t
    let p = from.at
    for (let k = 0; k < n; k++) {
      const x = order[k]
      if (p && x.lat != null) t += guess(p, x as LatLon)
      t = Math.max(t, ...fixed.filter((w) => w.s <= t && w.e > t).map((w) => w.e))
      t += x.visitMin
      if (x.lat != null) p = x as LatLon
    }
    return t
  }
  const insertAt = (minute: number) => {
    for (let n = 0; n <= order.length; n++) if (guessStart(n) >= minute) return n
    return order.length
  }
  const meals = [...located.filter((x) => timedMeals.has(x.key)), ...placelessMeals.filter((m) => m.mealAt != null)].sort((a, b) => a.mealAt! - b.mealAt!)
  for (const m of meals) order.splice(insertAt(m.mealAt!), 0, m)
  order.push(...placelessMeals.filter((m) => m.mealAt == null), ...rest)

  // A stretch after something fixed can't start before that thing is over; a meal not before its time.
  const notBefore = new Map<string, number>()
  stretches.forEach((st, k) => {
    if (k > 0) for (const x of st.seq) notBefore.set(x.key, st.s)
  })
  for (const m of meals) notBefore.set(m.key, Math.max(notBefore.get(m.key) ?? 0, m.mealAt!))

  const slotsArr = await layoutStops(
    order.map((m) => ({ lat: m.lat, lon: m.lon, name: m.name, visitMin: m.visitMin, notBefore: Math.max(notBefore.get(m.key) ?? 0, m.open ?? 0) })),
    from,
    fixed,
    pref,
    walkMax,
    speed,
    cutoff,
  )
  const slots = new Map<string, { from: number; to: number; leg?: Leg } | undefined>(movable.map((m) => [m.key, undefined]))
  order.forEach((m, n) => slots.set(m.key, slotsArr[n]))

  // A sunset or evening outing that no longer fits matters more than one more visit: the last ordinary visit before it
  // stays off the day instead (an idea without a time), and the day is fitted again.
  const missedSun = movable.find((m) => !m.meal && m.mealAt != null && !slots.get(m.key))
  if (missedSun) {
    const drop = order
      .map((m, n) => ({ m, s: slotsArr[n] }))
      .filter((x) => x.s && !x.m.meal && x.m.mealAt == null && x.s.from < missedSun.mealAt!)
      .sort((p, q) => q.s!.from - p.s!.from)[0]
    if (drop) {
      const again = await scheduleDay(ctx, fixedItems, movable.filter((m) => m.key !== drop.m.key))
      again.slots.set(drop.m.key, undefined)
      return again
    }
  }

  return { slots }
}

export interface DayProposal {
  changes: { item: Item; startTime?: string; endTime?: string; legIn?: Leg }[]
  order: { item: Item; startTime?: string; endTime?: string; leg?: Leg; moved: boolean }[]
  travelBefore: number
  travelAfter: number
}

/** Total travel along the day as it stands (stored legs where still right, else worked out). */
async function travelOf(dayItems: Item[], pref: GetAround, settings: Settings) {
  const timed = dayItems
    .filter((i) => i.startTime && i.status !== 'skipped' && FLEXIBLE.has(i.kind) && (i.location?.lat != null || i.walk?.stops.length))
    .sort((a, b) => a.startTime!.localeCompare(b.startTime!))
  let total = 0
  for (let n = 1; n < timed.length; n++) {
    const a = timed[n - 1].location?.lat != null ? (timed[n - 1].location as LatLon) : timed[n - 1].walk!.stops[0]
    const b = timed[n].location?.lat != null ? (timed[n].location as LatLon) : timed[n].walk!.stops[0]
    const stored = timed[n].legIn
    total += stored && stored.fromName === timed[n - 1].title ? stored.minutes : (await planLeg(a, b, pref, settings.walkMaxMin ?? DEFAULT_WALK_MAX_MIN, settings.walkSpeedKmh)).minutes
  }
  return total
}

/** "Optimise this day": a proposal (nothing is saved) that reorders what can move to cut travel, around what's kept. */
const AIRPORT = /airport|aeroporto|aeropuerto|a[ée]roport|flughafen|\(\w{3}\)/i

/**
 * The taxi (or shuttle) to or from the airport follows the flight: change the flight's time and the transfer moves with it,
 * 30 minutes after landing, or 3 hours before take-off (the ride plus check-in). Booked or 📌 locked transfers stay.
 */
export function alignTransfers(dayItems: Item[]): { item: Item; startTime: string }[] {
  const flights = dayItems.filter((i) => i.kind === 'flight' && i.status !== 'skipped' && i.startTime)
  const out: { item: Item; startTime: string }[] = []
  for (const t of dayItems) {
    if (!['taxi', 'bus', 'train'].includes(t.kind) || !t.startTime || t.locked || t.bookingRef || t.status === 'booked' || t.status === 'done') continue
    let want: number | undefined
    if (AIRPORT.test(t.from?.name ?? '')) {
      // Landing: the flight that lands before it (or the only one with an arrival time that day).
      const f = flights.filter((f) => f.endTime).sort((a, b) => b.endTime!.localeCompare(a.endTime!))[0]
      if (f) want = hhmmToMin(f.endTime!) + 30
    } else if (AIRPORT.test(t.to?.name ?? '')) {
      const f = flights.filter((f) => f.startTime! > t.startTime! || hhmmToMin(f.startTime!) - hhmmToMin(t.startTime!) > -360).sort((a, b) => a.startTime!.localeCompare(b.startTime!))[0]
      if (f) want = hhmmToMin(f.startTime!) - 180
    }
    if (want == null || want < 0 || want > 23 * 60 + 45) continue
    const startTime = minToHHMM(Math.ceil(want / 15) * 15)
    if (startTime !== t.startTime) out.push({ item: t, startTime })
  }
  return out
}

export async function proposeDay(tripId: string, date: string, settings: Settings, opts: { onlyUntimed?: boolean } = {}): Promise<DayProposal | undefined> {
  const trip = await db.trips.get(tripId)
  if (!trip) return undefined
  const [items, days, favs] = await Promise.all([
    db.items.where('tripId').equals(tripId).toArray(),
    db.days.where('tripId').equals(tripId).toArray(),
    db.favorites.where('tripId').equals(tripId).toArray(),
  ])
  const day = days.find((d) => d.date === date)
  const city = day?.city
  // Airport transfers first follow their flights, so the rest of the day is fitted around where they now are.
  const transfers = alignTransfers(items.filter((i) => i.date === date && i.status !== 'skipped'))
  const moved = new Map(transfers.map((t) => [t.item.id, t.startTime]))
  const dayItems = items.filter((i) => i.date === date && i.status !== 'skipped').map((i) => (moved.has(i.id) ? { ...i, startTime: moved.get(i.id)!, endTime: undefined } : i))
  // onlyUntimed: give times to what has none, leaving everything already timed where it is (the itinerary's own times).
  // A note without a time ("Checklist: arrival papers") stays a note for the day: it isn't given a time.
  const movableItems = dayItems.filter((i) => isMovable(i) && !(i.kind === 'note' && !i.startTime) && (!opts.onlyUntimed || !i.startTime))
  if (!movableItems.length && !transfers.length) return undefined
  const ids = new Set(movableItems.map((i) => i.id))
  const cityDays = city ? cityDates(days, city) : []
  const arriving = arrivalTest(city, day, date === cityDays[0])
  const plan = await scheduleDay({ trip, date, city, day, days, items, settings, arriving }, dayItems.filter((i) => !ids.has(i.id)), movableItems.map((i) => ownMovable(i, favs)))
  const pref = getAroundFor(day, settings, items, date)

  const changes: DayProposal['changes'] = transfers.map((t) => ({ item: t.item, startTime: t.startTime, endTime: t.item.endTime, legIn: t.item.legIn }))
  const original = new Map(items.map((i) => [i.id, i]))
  const after = dayItems.map((i) => {
    if (!ids.has(i.id)) return i
    const slot = plan.slots.get(i.id)
    const startTime = slot ? minToHHMM(Math.min(slot.from, 1439)) : undefined
    const endTime = slot ? minToHHMM(Math.min(slot.to, 1439)) : undefined
    const legIn = slot?.leg ?? (slot ? undefined : i.legIn)
    if (startTime !== i.startTime || endTime !== i.endTime) changes.push({ item: i, startTime, endTime, legIn })
    return { ...i, startTime, endTime, legIn }
  })
  const travelBefore = await travelOf(dayItems, pref, settings)
  const travelAfter = await travelOf(after, pref, settings)
  const order = after
    .filter((i) => i.startTime)
    .sort((a, b) => a.startTime!.localeCompare(b.startTime!))
    .map((i) => ({ item: original.get(i.id)!, startTime: i.startTime, endTime: i.endTime, leg: i.legIn, moved: changes.some((c) => c.item.id === i.id) }))
  return { changes, order, travelBefore, travelAfter }
}

/** Activities, meals, walks and notes on the day that can be planned but have no time yet. */
export const untimedItems = (items: Item[], date: string) => items.filter((i) => i.date === date && isMovable(i) && !i.startTime && i.kind !== 'note')

/** "Fit them into the day": times for what has none on that day, around everything that already has a time. */
export async function fillUntimed(tripId: string, date: string, settings: Settings): Promise<number> {
  const p = await proposeDay(tripId, date, settings, { onlyUntimed: true })
  if (!p) return 0
  await applyProposal(p)
  return p.changes.filter((c) => c.startTime).length
}

/** The same for every day of the trip (after choosing an itinerary, or from the Plan tab). */
export async function fillUntimedTrip(tripId: string, settings: Settings): Promise<number> {
  const trip = await db.trips.get(tripId)
  if (!trip) return 0
  let n = 0
  for (let d = trip.startDate; d <= trip.endDate; d = addDays(d, 1)) n += await fillUntimed(tripId, d, settings)
  return n
}

export async function applyProposal(p: DayProposal) {
  if (!p.changes.length) return
  await db.items.bulkUpdate(p.changes.map((c) => ({ key: c.item.id, changes: { startTime: c.startTime, endTime: c.endTime, legIn: c.legIn, autoTime: true } })))
  await touchTrip(p.changes[0].item.tripId)
}

/* ------------------------------ Timing a day ------------------------------ */

interface Window {
  s: number
  e: number
  at?: LatLon // where you are once it's over
  startAt?: LatLon // where it starts (a journey's departure point): what to reach before it
  title: string
}

/** A journey listed on this day that really leaves on a later one (a connection after an overnight flight). */
function leavesLater(i: Item, ctx: Pick<DayContext, 'trip' | 'date' | 'days' | 'items'>): boolean {
  if (i.kind !== 'flight' || !i.startTime) return false
  const zctx = { trip: ctx.trip, days: ctx.days, items: ctx.items }
  const tz = zoneOfDate(ctx.date, zctx)
  const span = tz ? transportSpan(i, zctx) : undefined
  return !!span && span.depUtc >= midnight(ctx.date, tz!) + 86_400_000
}

/**
 * A journey dated on an earlier day that lands on this one (the overnight flight from Sydney): from midnight until it's
 * down, in this day's time. The latest such landing, if any.
 */
function landingOn(ctx: Pick<DayContext, 'trip' | 'date' | 'days' | 'items'>): Window | undefined {
  const zctx = { trip: ctx.trip, days: ctx.days, items: ctx.items }
  const tz = zoneOfDate(ctx.date, zctx)
  if (!tz) return undefined
  const mid = midnight(ctx.date, tz)
  let best: Window | undefined
  for (const i of ctx.items) {
    if (!JOURNEYS.has(i.kind) || i.status === 'skipped' || i.date >= ctx.date || i.date < addDays(ctx.date, -2)) continue
    const span = transportSpan(i, zctx)
    const lands = span ? Math.round((span.arrUtc - mid) / 60000) : 0
    if (lands > 0 && lands < 24 * 60 && (!best || lands > best.e)) best = { s: 0, e: lands, at: placeLL(i.to), title: i.title }
  }
  return best
}

/** The fixed parts of a day (timed items that are not the planner's): places are fitted around them. */
const JOURNEYS = new Set(['flight', 'train', 'bus', 'ferry', 'car', 'drive'])

/**
 * Is this journey how you arrive in the day's city (rather than how you leave it)? Its destination is the city (by
 * coordinates or name), its start is elsewhere, or, when nothing says, it is the first day in that city.
 */
export function arrivalTest(city: string | undefined, day: Day | undefined, firstDayInCity: boolean) {
  const nearCity = (raw?: Place) => {
    const p = raw && trustedPlace(raw)
    return p?.lat != null && p.lon != null && day?.lat != null && day.lon != null ? haversineM({ lat: p.lat, lon: p.lon }, { lat: day.lat, lon: day.lon }) < 40000 : undefined
  }
  const named = (p?: Place) => (city && p?.name ? p.name.toLowerCase().includes(city.trim().toLowerCase()) : undefined)
  const km = (raw?: Place) => {
    const p = raw && (trustedPlace(raw).lat != null ? trustedPlace(raw) : cityIn(raw.name))
    return p?.lat != null && p.lon != null && day?.lat != null && day.lon != null ? haversineM({ lat: p.lat, lon: p.lon }, { lat: day.lat, lon: day.lon }) / 1000 : undefined
  }
  return (i: Item) => {
    if (nearCity(i.to) || named(i.to)) return true
    // Coming this way from far off (the flight from Sydney landing at an airport 85 km from where you sleep): an arrival.
    const from = km(i.from)
    const to = km(i.to)
    if (from != null && from > 300 && (to == null ? i.kind === 'flight' && !i.to : to < from)) return true
    return nearCity(i.to) ?? named(i.to) ?? (nearCity(i.from) === true || named(i.from) === true ? false : firstDayInCity)
  }
}

/** When the day's sightseeing has to end: before the first journey that leaves after it starts (the flight home, the train on). */
/**
 * When the day's sightseeing has to end: on the day you go home, before the journey out (2 h before a flight). On other days
 * a journey just moves you on (a drive to the next town, a flight to the islands): what comes after it happens there.
 */
function departureCutoff(dayItems: Item[], startMin: number, arriving: (i: Item) => boolean, lastDay = true): number | undefined {
  if (!lastDay) return undefined
  const leave = dayItems
    .filter((i) => i.startTime && !i.planner && i.status !== 'skipped' && JOURNEYS.has(i.kind) && !arriving(i) && hhmmToMin(i.startTime) > startMin)
    .sort((a, b) => a.startTime!.localeCompare(b.startTime!))[0]
  return leave ? hhmmToMin(leave.startTime!) - (leave.kind === 'flight' ? 120 : 30) : undefined
}

/**
 * The fixed parts of a day. `here` is the day's city, the starting point of a journey that doesn't say where it leaves from.
 * A journey without an end time lasts its distance at road speed; one that ends after midnight fills the rest of the day;
 * a flight out needs you at the airport 2 hours before.
 */
/** Where a place is: its coordinates (unless its name says otherwise), or a well-known city in its name. */
function placeLL(p?: Place): LatLon | undefined {
  if (!p) return undefined
  const q = trustedPlace(p)
  if (q.lat != null && q.lon != null) return { lat: q.lat, lon: q.lon }
  const c = cityIn(p.name)
  return c ? { lat: c.lat, lon: c.lon } : undefined
}

/** A journey that brings you here from far away (the flight in, a long train), as opposed to moving on from here. */
function arrivesFromAfar(i: Item, here: LatLon | undefined, arriving: (i: Item) => boolean) {
  if (!JOURNEYS.has(i.kind) || !arriving(i)) return false
  const from = placeLL(i.from)
  return from && here ? haversineM(from, here) > 60000 : i.kind === 'flight'
}

function fixedWindows(dayItems: Item[], here?: LatLon, arriving: (i: Item) => boolean = () => false): Window[] {
  // `here`: where the day starts (last night's hotel, or the city).
  const ll = placeLL
  let lastAt = here
  return [...dayItems]
    .filter((i) => i.startTime && i.status !== 'skipped' && i.kind !== 'stay')
    .sort((a, b) => a.startTime!.localeCompare(b.startTime!))
    .map((i) => {
      const journey = JOURNEYS.has(i.kind) || i.kind === 'taxi'
      // Where you are once it's over: the place itself, a tour's first stop, or where a journey lands. A place's own
      // coordinates are kept as they are: only journeys' ends are checked against their names ("Café de Paris" in London).
      const own = i.location?.lat != null && i.location.lon != null ? { lat: i.location.lat, lon: i.location.lon } : undefined
      const at = own ?? (journey ? ll(i.to) ?? ll(i.location) : undefined) ?? i.walk?.stops[0]
      // A journey that doesn't say where it leaves from leaves from wherever the previous fixed thing left you.
      const startAt = journey ? ll(i.from) ?? lastAt : at
      lastAt = at ?? lastAt
      const s = hhmmToMin(i.startTime!)
      let length = itemMinutes(i) || 30 // something with a time but no length (a taxi, a meal) still takes a moment
      if (journey && !i.endTime && startAt && at) length = Math.max(20, Math.round((haversineM(startAt, at) * 1.3) / 1000 / (i.kind === 'bus' ? 40 : 60) * 60))
      let e = i.endTime ? hhmmToMin(i.endTime) : s + length
      // Arriving from far away: its departure time is another place's clock; what counts here is when it lands.
      if (arrivesFromAfar(i, here, arriving)) return i.endTime ? { s: Math.max(0, e - 15), e, at, startAt: at, title: i.title } : undefined
      if (e < s) e = 24 * 60 // overnight
      const before = i.kind === 'flight' ? 120 : 0 // check-in for a flight out
      return { s: s - before, e, at, startAt, title: i.title }
    })
    .filter((w): w is NonNullable<typeof w> => !!w)
    .sort((x, y) => x.s - y.s)
}

/**
 * Lays places out one after the other from a starting time and place: travel there, visit, travel on. When something
 * fixed is in the way, the place goes after it and is reached from where that fixed thing is.
 */
/** Up to the next quarter hour: 9:02 → 9:15, 9:15 stays. */
const quarter = (m: number) => Math.ceil(m / 15) * 15

async function layoutStops(
  stops: { lat?: number; lon?: number; name: string; visitMin: number; notBefore?: number }[],
  from: { t: number; at?: LatLon; name: string },
  fixed: Window[],
  pref: GetAround,
  walkMax: number,
  speedKmh: number,
  cutoff = 24 * 60,
  fillGaps = false, // when the next stop doesn't fit before something fixed, use the gap for a later stop that does
): Promise<({ from: number; to: number; leg?: Leg } | undefined)[]> {
  const out: ({ from: number; to: number; leg?: Leg } | undefined)[] = stops.map(() => undefined)
  let t = from.t
  let prev = from.at
  let prevName = from.name
  let prevSince = from.t // since when you have been at `prev`

  const place = async (f: (typeof stops)[number]) => {
    // Something without a place (lunch, "free time") just follows on: no travel to work out.
    const here = f.lat != null && f.lon != null ? { lat: f.lat, lon: f.lon } : undefined
    // Went through something fixed since the last place (the museum you booked), or will before this one may start: you set off from there.
    const nb = f.notBefore ?? 0
    const passed = fixed.filter((w) => w.at && w.s >= prevSince && w.e <= Math.max(t, nb)).sort((x, y) => y.e - x.e)[0]
    const origin = passed?.at ?? prev
    const originName = passed ? passed.title : prevName
    const depart = passed ? Math.max(t, passed.e) : t
    let leg: Leg | undefined = here && origin ? { ...(await planLeg(origin, here, pref, walkMax, speedKmh)), fromName: originName } : undefined
    // Things start on the quarter hour (9:15, not 9:02): the few spare minutes are slack for the journey.
    let start = quarter(Math.max(depart + (leg?.minutes ?? 0), nb))
    let clashed = false
    for (const w of fixed) {
      if (!(start < w.e && start + f.visitMin > w.s)) continue
      clashed = true
      if (w.at && here) leg = { ...(await planLeg(w.at, here, pref, walkMax, speedKmh)), fromName: w.title }
      start = quarter(w.e + (w.at && here ? leg!.minutes : 0))
    }
    return { here, leg, start, clashed }
  }

  const queue = stops.map((_, i) => i)
  while (queue.length) {
    let pick = 0
    let c = await place(stops[queue[0]])
    if (fillGaps && c.clashed) {
      for (let k = 1; k < queue.length; k++) {
        const alt = await place(stops[queue[k]])
        if (!alt.clashed && alt.start + stops[queue[k]].visitMin <= cutoff) {
          pick = k
          c = alt
          break
        }
      }
    }
    const idx = queue.splice(pick, 1)[0]
    const f = stops[idx]
    if (c.start + f.visitMin > cutoff) continue // doesn't fit before you leave: stays on the day as an idea without a time
    out[idx] = { from: c.start, to: c.start + f.visitMin, leg: c.leg }
    t = c.start + f.visitMin
    if (c.here) {
      prev = c.here
      prevName = f.name
      prevSince = t
    } else if (c.leg === undefined) {
      // A meal without a place after something fixed: you're still where that was.
      const passed = fixed.filter((w) => w.at && w.s >= prevSince && w.e <= c.start).sort((x, y) => y.e - x.e)[0]
      if (passed) {
        prev = passed.at
        prevName = passed.title
        prevSince = passed.e
      }
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
    .filter((i) => i.id !== changed.id && isMovable(i) && i.startTime && after(i))
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
  const pref = getAroundFor(day, settings, await db.items.where('tripId').equals(changed.tripId).toArray(), changed.date)
  const here = day?.lat != null && day.lon != null ? { lat: day.lat, lon: day.lon } : undefined
  const fixed = fixedWindows(
    dayItems.filter((i) => !laterIds.has(i.id) && i.id !== changed.id && i.status !== 'done'),
    here,
  )
  const lastDay = changed.date === (await db.trips.get(changed.tripId))?.endDate
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
    notBefore: Math.max(hhmmToMin(i.startTime!) - freed, hoursOf({ title: i.title, kind: i.kind, category: i.category, hours: i.hours }, i.date).open ?? 0),
  }))
  const slots = await layoutStops(stops, start, fixed, pref, settings.walkMaxMin ?? DEFAULT_WALK_MAX_MIN, settings.walkSpeedKmh, departureCutoff(dayItems.filter((i) => i.id !== changed.id), start.t, arriving, lastDay))
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

async function reconcileNow(tripId: string, depth = 0): Promise<string[]> {
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

  // One name per city: "London, United Kingdom" and "London" are the same city, so the City planner shows it once with all
  // its days. The days, the wishlist places and the City planner's own items take the new name.
  const renamed = canonicalCities(days)
  if (renamed.size && depth < 3) {
    await db.transaction('rw', [db.days, db.favorites, db.items], async () => {
      for (const d of days) if (d.city && renamed.has(d.city)) await db.days.update(d.id, { city: renamed.get(d.city) })
      for (const f of favs) {
        const to = [...renamed].find(([old]) => sameCity(old, f.city))?.[1]
        if (to) await db.favorites.update(f.id, { city: to })
      }
      for (const i of items) {
        const to = [...renamed].find(([old]) => i.planner === plannerTag(old))?.[1]
        if (to) await db.items.update(i.id, { planner: plannerTag(to) })
      }
    })
    return reconcileNow(tripId, depth + 1) // everything below works with the new names
  }
  // Home isn't one of the trip's places ("Sydney → Rome → … → Sydney" from an itinerary is Rome and the rest).
  const away = trip.cities.filter((c) => !isHome(trip, { name: c }))
  if (away.length && away.length < trip.cities.length) await db.trips.update(trip.id, { cities: away })
  // The trip starts and ends at home's airport: the taxi to it (or home from it) isn't part of the plan.
  const goesAway = days.some((d) => d.city && !isHome(trip, { name: d.city, lat: d.lat, lon: d.lon }))
  const transfers = goesAway ? items.filter((i) => isHomeTransfer(trip, i)) : []
  if (transfers.length && depth < 3) {
    await db.items.bulkDelete(transfers.map((i) => i.id))
    return reconcileNow(tripId, depth + 1)
  }
  // An itinerary made before the app checked for it may lack the flight home: added once (one you delete stays deleted).
  if (trip.planBasis && !trip.homeLegsChecked) {
    await db.trips.update(trip.id, { homeLegsChecked: true })
    if (depth < 3 && (await addMissingHomeLegs(tripId))) return reconcileNow(tripId, depth + 1)
  }
  // One stay per city stretch (merged repeats, placeholders where there's none): every night has somewhere to end the day.
  if (depth < 3 && (await tidyStays(tripId))) return reconcileNow(tripId, depth + 1)

  // Journeys whose stored coordinates contradict their names (a chatbot's slip): the name's city wins, once and for all.
  const fixedPlaces = items.flatMap((i) => {
    if (!JOURNEYS.has(i.kind) && i.kind !== 'taxi') return []
    const to = i.to && trustedPlace(i.to)
    const from = i.from && trustedPlace(i.from)
    return to !== i.to || from !== i.from ? [{ key: i.id, changes: { to, from } }] : []
  })
  if (fixedPlaces.length) await db.items.bulkUpdate(fixedPlaces)

  // Two slips from chatbot itineraries, repaired once: a note that was given a time by the planner goes back to being a
  // note for the day; and a drive (or bus, train, taxi) written as lasting the whole outing ("Drive to Laguna Chaxa,
  // 08:00–12:00" around the 09:00 visit there) ends when the visit at its destination starts.
  const timeFixes: { key: string; changes: Partial<Item> }[] = []
  for (const it of items) {
    if (it.kind === 'note' && it.autoTime && it.startTime) timeFixes.push({ key: it.id, changes: { startTime: undefined, endTime: undefined, autoTime: undefined, legIn: undefined } })
    if (!['drive', 'bus', 'train', 'taxi'].includes(it.kind) || it.status === 'booked' || it.locked || !it.startTime || !it.endTime || it.to?.lat == null || it.to.lon == null) continue
    const [s, e] = [hhmmToMin(it.startTime), hhmmToMin(it.endTime)]
    const there = items
      .filter((o) => o.date === it.date && o.id !== it.id && o.startTime && !JOURNEYS.has(o.kind) && o.kind !== 'taxi' && o.kind !== 'stay' && o.status !== 'skipped')
      .filter((o) => o.location?.lat != null && o.location.lon != null && haversineM(o.location as LatLon, it.to as LatLon) < 10_000)
      .map((o) => hhmmToMin(o.startTime!))
      .filter((t) => t >= s + 15 && t < e)
    if (there.length) timeFixes.push({ key: it.id, changes: { endTime: minToHHMM(Math.min(...there)) } })
  }
  // Wishlist places whose visit time came in hours from a chatbot (1.5 = an hour and a half, not 90 seconds).
  for (const f of favs) {
    const fixed = visitMinutes(f.visitMin)
    if (fixed != null && fixed !== f.visitMin) change(f, { visitMin: fixed })
  }
  // Things the planner timed badly before it knew better are fitted again: a sunset (or night) outing far from its time,
  // and visits of a few minutes (squeezed in, or a wishlist place's hours read as minutes).
  const sunDates = new Set<string>()
  for (const it of items) {
    if (!it.autoTime || !it.startTime || !isMovable(it) || it.kind === 'note') continue
    const want = sunAt(ownMovable(it, favs), { trip, date: it.date, day: days.find((d) => d.date === it.date), days })
    const length = it.endTime ? hhmmToMin(it.endTime) - hhmmToMin(it.startTime) : undefined
    const fav = favs.find((f) => f.id === it.favId || f.itemId === it.id)
    const tiny = length != null && length >= 0 && length < (it.kind === 'meal' ? 20 : 10)
    const favLength = fav && favChanges.get(fav.id)?.visitMin
    if ((want != null && Math.abs(hhmmToMin(it.startTime) - want) > 90) || tiny || favLength) {
      if (it.planner && it.favId) continue // the City planner's own items are rebuilt below from the corrected place
      sunDates.add(it.date)
    }
  }
  // Plans made while yesterday's flight was still in the air: what starts before it has landed (or within the hour after)
  // is fitted again, after it. Booked and 📌 pinned things stay where you put them.
  const landingDirty: { city: string; date: string }[] = []
  for (const date of new Set(items.map((i) => i.date))) {
    const landing = landingOn({ trip, date, days, items })
    if (!landing) continue
    for (const it of items) {
      if (it.date !== date || !it.startTime || !isMovable(it) || it.kind === 'note' || hhmmToMin(it.startTime) >= landing.e + 60) continue
      if (it.planner && it.favId) {
        const city = days.find((d) => d.date === date)?.city
        if (city) landingDirty.push({ city, date })
        continue
      }
      timeFixes.push({ key: it.id, changes: { startTime: undefined, endTime: undefined, legIn: undefined } })
      sunDates.add(date)
    }
  }
  // Things planned into a journey that can't move (a flight with its check-in, a train, a taxi, anything booked or 📌) are
  // fitted again around it — after the repairs above, so a drive that was just shortened no longer counts its old end.
  const patch = new Map<string, Partial<Item>>()
  for (const f of timeFixes) patch.set(f.key, { ...patch.get(f.key), ...f.changes })
  const repaired = items.map((i) => (patch.has(i.id) ? { ...i, ...patch.get(i.id) } : i))
  for (const date of new Set(repaired.map((i) => i.date))) {
    const day = days.find((d) => d.date === date)
    const dayItems = repaired.filter((i) => i.date === date && i.status !== 'skipped')
    const ctx = { trip, date, days, items: repaired }
    const fixedOnes = dayItems.filter((i) => i.startTime && !isMovable(i) && !leavesLater(i, ctx))
    if (!fixedOnes.length) continue
    const here = day?.lat != null && day.lon != null ? { lat: day.lat, lon: day.lon } : undefined
    const arriving = arrivalTest(day?.city, day, !!day?.city && cityDates(days, day.city)[0] === date)
    const windows = fixedWindows(fixedOnes, here, arriving).filter((w) => w.e > w.s)
    for (const it of dayItems) {
      if (!it.startTime || !isMovable(it) || it.kind === 'note' || (it.planner && it.favId)) continue
      const s = hhmmToMin(it.startTime)
      const e = it.endTime && hhmmToMin(it.endTime) > s ? hhmmToMin(it.endTime) : s + (it.kind === 'meal' ? 60 : 30)
      if (windows.some((w) => s < w.e && e > w.s)) {
        timeFixes.push({ key: it.id, changes: { startTime: undefined, endTime: undefined, legIn: undefined } })
        sunDates.add(date)
      }
    }
  }
  // On those days, everything the planner timed is placed again (your own times and the itinerary's stay as they are).
  for (const it of items)
    if (sunDates.has(it.date) && it.autoTime && it.startTime && isMovable(it) && !(it.planner && it.favId))
      timeFixes.push({ key: it.id, changes: { startTime: undefined, endTime: undefined, legIn: undefined } })
  if (timeFixes.length) await db.items.bulkUpdate(timeFixes)

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
      else {
        // You added the same place yourself that day (a booked ticket, say): the wishlist place follows your item and the
        // planner's copy goes, so it isn't there twice.
        const yours = items.find((o) => o.date === it.date && !o.planner && !favs.some((g) => g.itemId === o.id) && matchesPlace(o, f))
        if (yours) {
          remove.add(it.id)
          change(f, { itemId: yours.id, pinned: true })
        }
      }
    } else if (it.kind === 'walk') {
      // A tour from the earlier version (one block for the whole day): rebuilt as one item per place.
      remove.add(it.id)
      const city = days.find((d) => d.date === it.date)?.city
      if (city && it.planner === plannerTag(city)) markDirty(city, it.date)
    }
  }
  for (const d of landingDirty) markDirty(d.city, d.date)
  // Days the City planner built from a place whose visit time was just corrected are built again.
  for (const f of favs) if (favChanges.get(f.id)?.visitMin && f.date && !f.itemId && cityDays(f.city).has(f.date)) markDirty(f.city, f.date)
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

  const wrote = favChanges.size > 0 || remove.size > 0 || touched.length > 0 || timeFixes.length > 0
  if (favChanges.size || remove.size) {
    await db.transaction('rw', [db.favorites, db.items], async () => {
      if (favChanges.size) await db.favorites.bulkUpdate([...favChanges].map(([key, changes]) => ({ key, changes })))
      if (remove.size) await db.items.bulkDelete([...remove])
    })
  }
  if (touched.length) await adoptPlannerItems(touched)
  if (sunDates.size) {
    const settings = await getSettings()
    for (const date of sunDates) await fillUntimed(tripId, date, settings)
  }
  if (dirty.size) {
    const settings = await getSettings()
    for (const { city, dates } of dirty.values()) await rebuildCityPlan(trip, city, [...dates].filter((d) => cityDays(city).has(d)), settings)
  } else if (wrote) await touchTrip(tripId)
  return released
}

/**
 * When the day can start: 9:30 (7:00 at the all-out pace), or after arriving from far away (the flight in, plus an hour; the taxi from the airport),
 * or after whatever is fixed first thing. Moving on during the day (a drive to the next town) doesn't delay the start:
 * the time before it is used where you are.
 */
function dayStart(dayItems: Item[], fixed: Window[], here: LatLon | undefined, arriving: (i: Item) => boolean, style: TripStyle): number {
  let t = DAY_FROM(style)
  for (const i of dayItems) {
    if (!i.startTime || i.status === 'skipped') continue
    if (arrivesFromAfar(i, here, arriving) && i.endTime) t = Math.max(t, hhmmToMin(i.endTime) + 60)
    if (i.kind === 'taxi' && arriving(i) && /airport|station|port|pier|harbou?r|\(\w{3}\)/i.test(i.from?.name ?? '')) t = Math.max(t, hhmmToMin(i.startTime) + (itemMinutes(i) || 30))
  }
  for (const w of fixed) if (w.s <= t + 30 && w.s >= t - 60 && w.e > t) t = Math.max(t, w.e)
  return Math.min(t, DAY_UNTIL(style))
}


/** The dates of the trip whose city is `city`. */
export function cityDates(days: Day[], city: string) {
  return days.filter((d) => sameCity(d.city, city)).map((d) => d.date).sort()
}
