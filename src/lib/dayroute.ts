// A day's path: every item with a place (planned by the City planner or added or edited by hand), in time order,
// with how to get from each to the next. Shared by Day by day and the City planner so both draw the same map.

import type { Day, GetAround, Item, Leg, Settings } from '../types'
import { useAsync } from './hooks'
import { haversineM } from './geo'
import { DEFAULT_WALK_MAX_MIN, planLeg } from './legs'

export interface RouteStop {
  item: Item
  at: { lat: number; lon: number } // where it is (an old walking tour: its first stop)
  leg?: Leg // how to get here from the previous stop (or from the start, for the first one)
}

export interface DayRoute {
  stops: RouteStop[]
  segments: { coords: [number, number][]; dashed: boolean }[]
  start?: { lat: number; lon: number; name?: string } // where the first leg begins, when known
}

const KINDS = new Set(['activity', 'meal', 'walk', 'note'])

/** Where an item is: its place, or the first stop of an old walking tour. */
export function placeAt(it: Item): { lat: number; lon: number } | undefined {
  if (it.location?.lat != null && it.location.lon != null) return { lat: it.location.lat, lon: it.location.lon }
  const s = it.walk?.stops[0]
  return s ? { lat: s.lat, lon: s.lon } : undefined
}

/** Items that belong on the day's map: they have coordinates and are still on the plan. */
export function routeItems(items: Item[], date: string): Item[] {
  return items
    .filter((i) => i.date === date && KINDS.has(i.kind) && i.status !== 'skipped' && placeAt(i))
    .sort((a, b) => (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99') || a.order - b.order)
}

const near = (p: [number, number] | undefined, at: { lat: number; lon: number }) => !!p && haversineM({ lat: p[1], lon: p[0] }, at) < 150

/** A stored leg is still right if it starts at the previous stop's name (or is the first) and ends at this place. */
function storedLeg(it: Item, prev?: Item): Leg | undefined {
  const l = it.legIn
  const g = l?.geometry
  if (!l || !g?.length || !near(g[g.length - 1], placeAt(it)!)) return undefined
  if (prev && l.fromName !== prev.title) return undefined
  if (prev && !near(g[0], placeAt(prev)!)) return undefined
  return l
}

export async function buildRoute(stops: Item[], pref: GetAround, settings: Settings): Promise<DayRoute> {
  const out: RouteStop[] = []
  let start: DayRoute['start']
  for (let i = 0; i < stops.length; i++) {
    const it = stops[i]
    const prev = stops[i - 1]
    let leg = storedLeg(it, prev)
    if (!leg && prev) {
      const a = placeAt(prev)!
      const b = placeAt(it)!
      leg = { ...(await planLeg(a, b, pref, settings.walkMaxMin ?? DEFAULT_WALK_MAX_MIN, settings.walkSpeedKmh)), fromName: prev.title }
    }
    if (!prev && leg?.geometry?.length) start = { lat: leg.geometry[0][1], lon: leg.geometry[0][0], name: leg.fromName }
    out.push({ item: it, at: placeAt(it)!, leg })
  }
  const segments = out.filter((s) => s.leg?.geometry?.length).map((s) => ({ coords: s.leg!.geometry!, dashed: s.leg!.mode === 'transit' }))
  // Old walking tours (one item with its own path) keep drawing that path.
  for (const s of out) if (s.item.walk?.geometry?.length) segments.push({ coords: s.item.walk.geometry, dashed: s.item.walk.routedBy === 'straight-line' })
  return { stops: out, segments, start }
}

/** The day's route, rebuilt whenever its places, times or the way of getting around change. */
export function useDayRoute(items: Item[], date: string, day: Day | undefined, settings: Settings) {
  const stops = routeItems(items, date)
  const pref = day?.getAround ?? settings.getAround ?? 'transit'
  const key = [pref, settings.walkMaxMin, settings.walkSpeedKmh, ...stops.map((i) => `${i.id}|${i.startTime}|${placeAt(i)?.lat}|${placeAt(i)?.lon}|${i.legIn?.minutes}`)].join(';')
  const r = useAsync(() => (stops.length ? buildRoute(stops, pref, settings) : Promise.resolve({ stops: [], segments: [] } as DayRoute)), [key])
  return { route: r.data, loading: r.loading, stops }
}
