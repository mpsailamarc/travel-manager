// Getting from one place to the next: on foot, by public transport or by taxi. Walking and taxi use the free OSRM
// routers; public transport has no free routing service, so it is an estimate (waiting + average speed) with a
// link to real timetables.

import type { GetAround, Leg } from '../types'
import { drivingRoute, walkingRoute } from './apis'
import { haversineM, type LatLon } from './geo'

export const DEFAULT_WALK_MAX_MIN = 15
const TAXI_WAIT_MIN = 5
const TRANSIT_WAIT_MIN = 10 // getting to the stop, waiting, getting from the stop
const TRANSIT_KMH = 18 // average door-to-stop city speed, stops included

export const GET_AROUND_LABEL: Record<GetAround, string> = {
  walk: '🚶 Walk everywhere',
  transit: '🚇 Walk short hops, public transport for longer ones',
  taxi: '🚕 Walk short hops, taxi for longer ones',
  fastest: '⚡ Whatever is quickest',
}

export const MODE_EMOJI = { walk: '🚶', transit: '🚇', taxi: '🚕' } as const

/** Map colours: walking green, public transport blue (dashed: its path is approximate), taxi orange. */
export const MODE_COLOR = { walk: '#16a34a', transit: '#2563eb', taxi: '#ea580c' } as const
export const MODE_DASHED = { walk: false, transit: true, taxi: false } as const

async function walkLeg(a: LatLon, b: LatLon, speedKmh: number): Promise<Leg> {
  const speed = (speedKmh * 1000) / 3600
  try {
    const r = await walkingRoute([a, b])
    return { mode: 'walk', distanceM: r.distanceM, minutes: Math.round(r.distanceM / speed / 60), geometry: r.geometry }
  } catch {
    const d = haversineM(a, b) * 1.3
    return { mode: 'walk', distanceM: d, minutes: Math.round(d / speed / 60), geometry: [[a.lon, a.lat], [b.lon, b.lat]], estimated: true }
  }
}

async function taxiLeg(a: LatLon, b: LatLon): Promise<Leg> {
  try {
    const r = await drivingRoute(a, b)
    return { mode: 'taxi', distanceM: r.distanceM, minutes: Math.round(r.durationS / 60) + TAXI_WAIT_MIN, geometry: r.geometry }
  } catch {
    const d = haversineM(a, b) * 1.3
    return { mode: 'taxi', distanceM: d, minutes: Math.round(d / 1000 / 25 * 60) + TAXI_WAIT_MIN, geometry: [[a.lon, a.lat], [b.lon, b.lat]], estimated: true }
  }
}

/**
 * Public transport has no free router: street distance at an average speed, plus the wait. It's drawn along the roads
 * (the way a bus or tram would roughly go) rather than as a straight line.
 */
async function transitLeg(a: LatLon, b: LatLon, streetM: number): Promise<Leg> {
  let geometry: [number, number][] = [[a.lon, a.lat], [b.lon, b.lat]]
  try {
    geometry = (await drivingRoute(a, b)).geometry
  } catch {
    /* offline or busy: a straight line */
  }
  return { mode: 'transit', distanceM: streetM, minutes: Math.round(TRANSIT_WAIT_MIN + (streetM / 1000 / TRANSIT_KMH) * 60), geometry, estimated: true }
}

/** The way to get from a to b under the chosen rule. Short hops are always walked (unless you chose taxi/transit everywhere). */
export async function planLeg(a: LatLon, b: LatLon, pref: GetAround, walkMaxMin = DEFAULT_WALK_MAX_MIN, speedKmh = 4.5): Promise<Leg> {
  const walk = await walkLeg(a, b, speedKmh)
  if (pref === 'walk' || walk.minutes <= walkMaxMin) return walk
  if (pref === 'transit') return transitLeg(a, b, walk.distanceM)
  if (pref === 'taxi') return taxiLeg(a, b)
  const [taxi, transit] = [await taxiLeg(a, b), await transitLeg(a, b, walk.distanceM)]
  return [walk, transit, taxi].reduce((best, l) => (l.minutes < best.minutes ? l : best))
}

/** "🚶 12 min · 900 m", "🚇 about 25 min (estimate)" */
export function legText(l: Leg, fmtDistance: (m: number) => string): string {
  const mins = l.minutes < 60 ? `${l.minutes} min` : `${Math.floor(l.minutes / 60)} h ${String(l.minutes % 60).padStart(2, '0')}`
  return `${MODE_EMOJI[l.mode]} ${l.mode === 'transit' ? `about ${mins} (estimate)` : mins} · ${fmtDistance(l.distanceM)}`
}

/** Real timetables and fares live outside the app: these open the same trip there. */
export function transitLink(a: LatLon, b: LatLon) {
  return `https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lon}&destination=${b.lat},${b.lon}&travelmode=transit`
}
export function taxiLink(a: LatLon, b: LatLon) {
  return `https://m.uber.com/ul/?action=setPickup&pickup[latitude]=${a.lat}&pickup[longitude]=${a.lon}&dropoff[latitude]=${b.lat}&dropoff[longitude]=${b.lon}`
}
