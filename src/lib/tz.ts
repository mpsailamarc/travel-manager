// Time zones. Times are typed as clock times in the place where they happen: a flight departs at Sydney time and
// arrives at Tokyo time. The calendar for a day is in that day's destination time, so a departure is converted for it.
// Zones come from coordinates, offline (tz-lookup); nothing is sent anywhere.

import tzlookup from 'tz-lookup'
import type { Day, HHMM, Item, ISODate, Trip } from '../types'
import { addDays, hhmmToMin } from './dates'
import { country } from './countries'
import { cityIn, trustedPlace } from './cities'
import type { Place } from '../types'

export function tzAt(lat?: number, lon?: number): string | undefined {
  if (lat == null || lon == null) return undefined
  try {
    return tzlookup(lat, lon)
  } catch {
    return undefined
  }
}

/** A place's zone: from its coordinates, else from a well-known city or airport code in its name ("Sydney Airport"). */
export function tzOfPlace(p?: Pick<Place, 'name' | 'lat' | 'lon'>): string | undefined {
  if (!p) return undefined
  const q = trustedPlace(p)
  const c = q.lat == null ? cityIn(q.name) : undefined
  return tzAt(q.lat, q.lon) ?? tzAt(c?.lat, c?.lon)
}

const formats = new Map<string, Intl.DateTimeFormat>()
function parts(tz: string, utcMs: number) {
  let f = formats.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    formats.set(tz, f)
  }
  const o: Record<string, number> = {}
  for (const p of f.formatToParts(new Date(utcMs))) if (p.type !== 'literal') o[p.type] = Number(p.value)
  return o
}

/** Minutes the zone is ahead of UTC at that instant (Tokyo: +540). */
export function offsetMin(tz: string, utcMs: number): number {
  const p = parts(tz, utcMs)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second)
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000)
}

/** The instant (ms since epoch) when the clock in `tz` shows `hhmm` on `date`. */
export function zonedToUtc(date: ISODate, hhmm: HHMM, tz: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi] = hhmm.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, h, mi)
  const first = guess - offsetMin(tz, guess) * 60000
  return guess - offsetMin(tz, first) * 60000 // second pass settles daylight-saving changes
}

export const midnight = (date: ISODate, tz: string) => zonedToUtc(date, '00:00', tz)

export const tzCity = (tz: string) => tz.split('/').pop()!.replace(/_/g, ' ')

export function tzOffsetLabel(tz: string, utcMs = Date.now()): string {
  const o = offsetMin(tz, utcMs)
  const sign = o < 0 ? '−' : '+'
  const a = Math.abs(o)
  return `UTC${sign}${Math.floor(a / 60)}${a % 60 ? ':' + String(a % 60).padStart(2, '0') : ''}`
}

/** "Tokyo (UTC+9)" */
export const tzLabel = (tz: string, utcMs?: number) => `${tzCity(tz)} (${tzOffsetLabel(tz, utcMs)})`

/* ------------------------- which zone applies where ------------------------- */

export interface ZoneCtx {
  trip: Trip
  days: Day[]
}

const TRANSPORT = new Set(['flight', 'train', 'bus', 'car', 'drive', 'ferry', 'taxi'])
export const isTransportKind = (k: string) => TRANSPORT.has(k)

const dayZone = (d?: Day) => d?.tz ?? tzAt(d?.lat, d?.lon)

/** The zone of a trip day: its own city, else the closest day with a location, else the country's capital. */
export function zoneOfDate(date: ISODate, ctx: ZoneCtx): string | undefined {
  const sorted = [...ctx.days].sort((a, b) => a.date.localeCompare(b.date))
  const own = dayZone(sorted.find((d) => d.date === date))
  if (own) return own
  const before = [...sorted].reverse().find((d) => d.date < date && dayZone(d))
  if (before) return dayZone(before)
  const after = sorted.find((d) => d.date > date && dayZone(d))
  if (after) return dayZone(after)
  const cap = country(ctx.trip.countryCodes[0])?.capital
  return cap ? tzAt(cap.lat, cap.lon) : undefined
}

export interface ItemZones {
  from?: string // zone of the start time
  to?: string // zone of the end time
  auto: { from?: string; to?: string } // what the app works out, before any override
}

export function itemZones(it: Pick<Item, 'kind' | 'date' | 'from' | 'to' | 'fromTz' | 'toTz'>, ctx: ZoneCtx): ItemZones {
  const here = zoneOfDate(it.date, ctx)
  if (!isTransportKind(it.kind)) return { from: here, to: here, auto: { from: here, to: here } }
  const autoTo = tzOfPlace(it.to) ?? here
  const prev = [...ctx.days].filter((d) => d.date < it.date && dayZone(d)).sort((a, b) => b.date.localeCompare(a.date))[0]
  const start = ctx.trip.startPlace
  const autoFrom = tzOfPlace(it.from) ?? (prev ? dayZone(prev) : it.date <= ctx.trip.startDate ? tzAt(start?.lat, start?.lon) : undefined) ?? autoTo
  return { from: it.fromTz ?? autoFrom, to: it.toTz ?? autoTo, auto: { from: autoFrom, to: autoTo } }
}

export interface TransportSpan {
  depUtc: number
  arrUtc: number
  durationMin: number
  fromTz: string
  toTz: string
  arrDate: ISODate // the date on the clock where it lands
  zonesDiffer: boolean
}

/** A transport item's real start and end instants and travel time, from the two clock times and their zones. */
export function transportSpan(it: Item, ctx: ZoneCtx): TransportSpan | undefined {
  if (!isTransportKind(it.kind) || !it.startTime || !it.endTime) return undefined
  const z = itemZones(it, ctx)
  if (!z.from || !z.to) return undefined
  const depUtc = zonedToUtc(it.date, it.startTime, z.from)
  // The first moment after departure when the arrival clock shows that time: it may be the next day, or even the previous date across the date line.
  let arrUtc = Infinity
  let arrDate = it.date
  for (const k of [-1, 0, 1, 2]) {
    const date = addDays(it.date, k)
    const t = zonedToUtc(date, it.endTime, z.to)
    if (t > depUtc && t < arrUtc) {
      arrUtc = t
      arrDate = date
    }
  }
  if (!isFinite(arrUtc)) return undefined
  return { depUtc, arrUtc, durationMin: Math.round((arrUtc - depUtc) / 60000), fromTz: z.from, toTz: z.to, arrDate, zonesDiffer: z.from !== z.to }
}

/** Travel time of a transport item (zone-aware), else the plain difference between its two clock times. */
export function durationMin(it: Item, ctx: ZoneCtx): number | undefined {
  if (!it.startTime || !it.endTime) return undefined
  const span = transportSpan(it, ctx)
  if (span) return span.durationMin
  return (hhmmToMin(it.endTime) - hhmmToMin(it.startTime) + 1440) % 1440
}
