// Favourites per city and "Plan my days": spread them over the days you spend in that city,
// grouped by neighbourhood and sized to your pace. Runs entirely in the browser.

import { adoptPlannerItems, db, getSettings, touchTrip } from '../db'
import type { Day, Favorite, GetAround, Item, Leg, Place, Settings, Trip, TripStyle } from '../types'
import { POI_CATEGORIES } from './apis'
import { matchesPlace } from './duplicates'
import { openingWindow } from './hours'
import { DEFAULT_WALK_MAX_MIN, planLeg } from './legs'
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
      if (plan.back) {
        built.push({
          id: uid(),
          tripId: trip.id,
          date,
          kind: 'note',
          title: `Back to ${plan.back.to.name}`,
          startTime: minToHHMM(Math.min(plan.back.at, 1439)),
          status: 'planned',
          order: order++,
          location: plan.back.to,
          planner: tag,
          legIn: plan.back.leg,
        })
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

  await db.transaction('rw', db.items, async () => {
    const old = items.filter((i) => i.planner === tag && dates.includes(i.date))
    await db.items.bulkDelete(old.map((i) => i.id))
    await db.items.bulkAdd(built)
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
  const visitMin =
    own != null && own > 0 ? own : linked ? linked.visitMin : i.walk ? Math.round(i.walk.walkS / 60 + i.walk.stops.reduce((a, x) => a + x.visitMin, 0)) : i.kind === 'meal' ? 60 : i.kind === 'note' ? 30 : 90
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
  back?: { to: Place; at: number; leg: Leg } // "back to the start" at the end, when asked for
}

/** A quick travel-time guess (no network) for choosing the order; the real routes come after. */
function guessMin(a: LatLon, b: LatLon, pref: GetAround, walkMax: number, speedKmh: number) {
  const d = haversineM(a, b) * 1.3
  const walk = d / ((speedKmh * 1000) / 60)
  if (pref === 'walk' || walk <= walkMax) return walk
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
  const pref = day?.getAround ?? settings.getAround ?? 'transit'
  const walkMax = settings.walkMaxMin ?? DEFAULT_WALK_MAX_MIN
  const speed = settings.walkSpeedKmh
  const guess = (a: LatLon, b: LatLon) => guessMin(a, b, pref, walkMax, speed)

  const stay = items.find((i) => i.kind === 'stay' && i.date <= date && date < addDays(i.date, i.nights ?? 1) && i.location?.lat != null)
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
  const roundTrip = !!day?.walkRoundTrip && !!home

  const startTime = day?.walkStartTime ? hhmmToMin(day.walkStartTime) : hhmmToMin(firstFreeSlot(fixedItems, ctx.arriving))
  const fixed = fixedWindows(fixedItems)
  const cutoff = departureCutoff(fixedItems, startTime, ctx.arriving)
  const dayEnd = cutoff ?? 22 * 60

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
    if (w.s > cur.t) stretches.push({ s: cur.t, e: w.s, a: cur.at, b: w.at, seq: [] })
    cur = { t: Math.max(cur.t, w.e), at: w.at }
  }
  stretches.push({ s: cur.t, e: dayEnd, a: cur.at, b: roundTrip ? home : undefined, seq: [] })

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
    return over > 0 && !(last && cutoff == null) ? over * 20 : 0
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

  // One running order. Meals go in at their time of day (lunch around noon, dinner in the evening): a meal with a place
  // keeps the stretch it was given but moves to that time; a meal with no place just slots in. Other place-less things go last.
  const timedMeals = new Set(stretches.flatMap((st) => st.seq.filter((x) => x.meal && x.mealAt != null).map((x) => x.key)))
  const order: Movable[] = stretches.flatMap((st) => st.seq.filter((x) => !timedMeals.has(x.key)))
  const noPlace = movable.filter((m) => m.lat == null || m.lon == null)
  const placelessMeals = noPlace.filter((m) => m.meal).map((m, k) => ({ ...m, mealAt: m.mealAt ?? (k === 0 ? 12 * 60 : k === 1 ? 19 * 60 : undefined) }))
  const rest = noPlace.filter((m) => !m.meal)
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

  let back: DayPlan['back']
  if (roundTrip && home && startPlace) {
    const done = order.map((m, n) => ({ m, s: slotsArr[n] })).filter((x) => x.s && x.m.lat != null).sort((a, b) => b.s!.to - a.s!.to)[0]
    if (done) {
      const leg = { ...(await planLeg({ lat: done.m.lat!, lon: done.m.lon! }, home, pref, walkMax, speed)), fromName: done.m.name }
      back = { to: startPlace, at: quarter(done.s!.to + leg.minutes), leg }
    }
  }
  return { slots, back }
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
export async function proposeDay(tripId: string, date: string, settings: Settings): Promise<DayProposal | undefined> {
  const trip = await db.trips.get(tripId)
  if (!trip) return undefined
  const [items, days, favs] = await Promise.all([
    db.items.where('tripId').equals(tripId).toArray(),
    db.days.where('tripId').equals(tripId).toArray(),
    db.favorites.where('tripId').equals(tripId).toArray(),
  ])
  const day = days.find((d) => d.date === date)
  const city = day?.city
  const dayItems = items.filter((i) => i.date === date && i.status !== 'skipped')
  const movableItems = dayItems.filter(isMovable)
  if (!movableItems.length) return undefined
  const ids = new Set(movableItems.map((i) => i.id))
  const cityDays = city ? cityDates(days, city) : []
  const arriving = arrivalTest(city, day, date === cityDays[0])
  const plan = await scheduleDay({ trip, date, city, day, days, items, settings, arriving }, dayItems.filter((i) => !ids.has(i.id)), movableItems.map((i) => ownMovable(i, favs)))
  const pref = day?.getAround ?? settings.getAround ?? 'transit'

  const changes: DayProposal['changes'] = []
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
    .map((i) => ({ item: dayItems.find((x) => x.id === i.id)!, startTime: i.startTime, endTime: i.endTime, leg: i.legIn, moved: changes.some((c) => c.item.id === i.id) }))
  return { changes, order, travelBefore, travelAfter }
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
      // Where you are once it's over: the place itself, a tour's first stop, or where a journey lands.
      const p = i.location?.lat != null ? i.location : JOURNEYS.has(i.kind) && i.to?.lat != null ? i.to : undefined
      const at = p?.lat != null && p.lon != null ? { lat: p.lat, lon: p.lon } : i.walk?.stops[0]
      // Something with a time but no length (a taxi, a meal) still takes a moment: half an hour.
      return { s: hhmmToMin(i.startTime!), e: i.endTime ? hhmmToMin(i.endTime) : hhmmToMin(i.startTime!) + (itemMinutes(i) || 30), at, title: i.title }
    })
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
    notBefore: Math.max(hhmmToMin(i.startTime!) - freed, hoursOf({ title: i.title, kind: i.kind, category: i.category, hours: i.hours }, i.date).open ?? 0),
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
