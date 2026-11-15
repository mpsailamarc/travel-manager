// A day's path: where you slept, then every item with a place (planned by the City planner, added or edited by hand, and the
// day's drives, trains, buses, boats, taxis and flights), in time order, with how you get from each to the next. A flight is
// the way to its airport, then a straight dashed line to where it lands. Shared by Day by day
// and the City planner so both draw the same map.

import type { Day, GetAround, Item, Leg, Place, Settings } from '../types'
import { useAsync } from './hooks'
import { haversineM } from './geo'
import { addDays } from './dates'
import { cityIn, trustedPlace } from './cities'
import { DEFAULT_WALK_MAX_MIN, getAroundFor, MODE_COLOR, MODE_DASHED, planLeg } from './legs'

export interface RouteStop {
  item: Item
  access?: Leg // a flight: getting to the airport it leaves from
  at: { lat: number; lon: number } // where it is (a journey: where it takes you; an old walking tour: its first stop)
  leg?: Leg // how to get here from the previous stop (or from the start, for the first one)
}

export interface DayRoute {
  stops: RouteStop[]
  segments: { coords: [number, number][]; dashed: boolean; color?: string }[]
  start?: { lat: number; lon: number; name?: string } // where the day begins (last night's hotel), when known
}

const PLACES = new Set(['activity', 'meal', 'walk', 'note'])
const MOVES = new Set(['drive', 'car', 'train', 'bus', 'ferry', 'taxi', 'flight'])

const ll = (p?: Place) => {
  if (!p) return undefined
  const q = trustedPlace(p)
  if (q.lat != null && q.lon != null) return { lat: q.lat, lon: q.lon }
  const c = cityIn(p.name)
  return c ? { lat: c.lat, lon: c.lon } : undefined
}

/** Where an item is: its place; for a journey, where it takes you (a car pick-up: where you collect it); an old tour: its first stop. */
export function placeAt(it: Item): { lat: number; lon: number } | undefined {
  if (MOVES.has(it.kind)) {
    if (it.kind === 'car') return ll(it.location) ?? ll(it.to) ?? ll(it.from) ?? ll({ name: it.title })
    return ll(it.to)
  }
  if (it.location?.lat != null && it.location.lon != null) return { lat: it.location.lat, lon: it.location.lon }
  const s = it.walk?.stops[0]
  return s ? { lat: s.lat, lon: s.lon } : undefined
}

/** Items that belong on the day's map: they have coordinates and are still on the plan. */
export function routeItems(items: Item[], date: string): Item[] {
  return items
    .filter((i) => i.date === date && (PLACES.has(i.kind) || MOVES.has(i.kind)) && i.status !== 'skipped' && placeAt(i))
    .sort((a, b) => (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99') || a.order - b.order)
}

/** Where the day begins: the hotel you slept in (on a moving day that's last night's), else tonight's. */
export function dayStartPlace(items: Item[], date: string): { lat: number; lon: number; name: string } | undefined {
  const covers = (d: string) => (i: Item) => i.kind === 'stay' && i.date <= d && d < addDays(i.date, i.nights ?? 1) && i.location?.lat != null
  const stay = items.find(covers(addDays(date, -1))) ?? items.find(covers(date))
  return stay?.location?.lat != null && stay.location.lon != null ? { lat: stay.location.lat, lon: stay.location.lon, name: stay.title } : undefined
}

const near = (p: [number, number] | undefined, at: { lat: number; lon: number }) => !!p && haversineM({ lat: p[1], lon: p[0] }, at) < 150

/** A stored leg is still right if it starts at the previous stop's name (or is the first) and ends at this place. */
function storedLeg(it: Item, prev?: Item): Leg | undefined {
  if (MOVES.has(it.kind)) return undefined
  const l = it.legIn
  const g = l?.geometry
  if (!l || !g?.length || !near(g[g.length - 1], placeAt(it)!)) return undefined
  if (prev && l.fromName !== prev.title) return undefined
  if (prev && !near(g[0], placeAt(prev)!)) return undefined
  return l
}

/** How a journey goes: drives and car pick-ups by road, taxis by taxi, trains and buses along the roads (approximate), boats straight. */
function journeyPref(it: Item, pref: GetAround): GetAround | 'boat' | undefined {
  if (it.kind === 'drive') return 'car'
  if (it.kind === 'taxi') return 'taxi'
  if (it.kind === 'train' || it.kind === 'bus') return 'transit'
  if (it.kind === 'ferry') return 'boat'
  return pref === 'car' ? 'walk' : pref // getting to the car rental office
}

export async function buildRoute(stops: Item[], pref: GetAround, settings: Settings, begin?: { lat: number; lon: number; name: string }): Promise<DayRoute> {
  const out: RouteStop[] = []
  const walkMax = settings.walkMaxMin ?? DEFAULT_WALK_MAX_MIN
  const leg = async (a: { lat: number; lon: number }, b: { lat: number; lon: number }, it: Item, fromName: string): Promise<Leg | undefined> => {
    if (haversineM(a, b) < 50) return undefined
    const how = MOVES.has(it.kind) ? journeyPref(it, pref) : pref
    if (how === 'boat') return { mode: 'transit', minutes: 0, distanceM: haversineM(a, b), geometry: [[a.lon, a.lat], [b.lon, b.lat]], estimated: true, fromName }
    // A drive is by road even when the hop is short; anything else follows the day's way of getting around.
    const l = await planLeg(a, b, how ?? pref, it.kind === 'drive' ? 0 : walkMax, settings.walkSpeedKmh)
    return { ...l, fromName }
  }
  // The path goes through what has a time, in order; things without a time yet are on the map but not on the path.
  let prev: Item | undefined
  for (const it of stops) {
    const at = placeAt(it)!
    if (!it.startTime) {
      out.push({ item: it, at })
      continue
    }
    if (it.kind === 'flight') {
      // To the airport it leaves from (when that's known and not where you already are), then straight to where it lands.
      const origin = prev ? placeAt(prev)! : begin
      const dep = ll(it.from)
      const access = origin && dep && haversineM(origin, dep) > 500 ? { ...(await planLeg(origin, dep, pref, walkMax, settings.walkSpeedKmh)), fromName: prev?.title ?? begin?.name } : undefined
      // Without the departure airport, it flies from where you were — unless that's where it lands (arriving, the hotel is tonight's).
      const a = dep ?? (origin && haversineM(origin, at) > 50_000 ? origin : undefined)
      const km = a ? haversineM(a, at) / 1000 : 0
      const flight: Leg | undefined = a
        ? { mode: 'flight', minutes: Math.round((km / 800) * 60 + 30), distanceM: km * 1000, geometry: [[a.lon, a.lat], [at.lon, at.lat]], estimated: true, fromName: it.from?.name ?? prev?.title ?? begin?.name }
        : undefined
      out.push({ item: it, at, access, leg: flight })
      prev = it
      continue
    }
    let l = storedLeg(it, prev)
    if (!l && prev) l = await leg(placeAt(prev)!, at, it, prev.title)
    if (!l && !prev && begin) l = await leg(begin, at, it, begin.name)
    out.push({ item: it, at, leg: l })
    prev = it
  }
  const first = out[0]?.leg?.geometry?.[0]
  const start = begin ?? (first ? { lat: first[1], lon: first[0], name: out[0].leg!.fromName } : undefined)
  const segments = out
    .flatMap((s) => [s.access, s.leg].filter((l): l is Leg => !!l?.geometry?.length).map((l) => ({ l, ferry: s.item.kind === 'ferry' && l === s.leg })))
    .map(({ l, ferry }) => ({ coords: l.geometry!, dashed: ferry || MODE_DASHED[l.mode], color: ferry ? '#0891b2' : MODE_COLOR[l.mode] }))
  // Old walking tours (one item with its own path) keep drawing that path.
  for (const s of out) if (s.item.walk?.geometry?.length) segments.push({ coords: s.item.walk.geometry, dashed: s.item.walk.routedBy === 'straight-line', color: MODE_COLOR.walk })
  return { stops: out, segments, start }
}

/** The day's route, rebuilt whenever its places, times or the way of getting around change. */
export function useDayRoute(items: Item[], date: string, day: Day | undefined, settings: Settings) {
  const stops = routeItems(items, date)
  const pref = getAroundFor(day, settings, items, date)
  const begin = dayStartPlace(items, date)
  const key = [pref, settings.walkMaxMin, settings.walkSpeedKmh, begin?.lat, begin?.lon, ...stops.map((i) => `${i.id}|${i.startTime}|${placeAt(i)?.lat}|${placeAt(i)?.lon}|${i.legIn?.minutes}`)].join(';')
  const r = useAsync(() => (stops.length ? buildRoute(stops, pref, settings, begin) : Promise.resolve({ stops: [], segments: [] } as DayRoute)), [key])
  return { route: r.data, loading: r.loading, stops }
}
