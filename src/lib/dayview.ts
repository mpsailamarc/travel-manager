// What the calendar shows for one day: every item as a start and end in minutes, in the day's own (destination) time.
// A flight typed as "22:30 Sydney → 07:00 Tokyo" is placed at its real moments in Tokyo time, and on the next
// morning's calendar it appears again as the part that lands.

import type { Item } from '../types'
import type { ISODate } from '../types'
import { addDays, formatDuration, hhmmToMin } from './dates'
import { isTransportKind, midnight, offsetMin, transportSpan, tzAt, tzCity, zoneOfDate, zonedToUtc, itemZones, type TransportSpan, type ZoneCtx } from './tz'
import { atHome } from './home'

export interface DayEntry {
  item: Item
  start: number // minutes from midnight of the day, in the day's zone (0–1440)
  end?: number // undefined = no end time known
  spill?: boolean // the landing part of a journey that started the day before
  clippedStart?: boolean // began before this day's midnight
  clippedEnd?: boolean // continues after this day's midnight
  converted?: boolean // its times were converted from another zone
  zoneNote?: string // "22:30 Sydney → 07:00 Tokyo"
  /** The flight from or to home, shown only as when it lands (at the start) or leaves (at the end). */
  marker?: 'lands' | 'departs'
  /** On a day that changes time zone: the zone this item's own times are in, when it isn't the one the calendar shows. */
  otherZone?: string
  /** Minutes to add to the calendar's times to get the item's own clock (dragging it writes its own local time). */
  shift?: number
}

export interface DayView {
  tz?: string
  entries: DayEntry[]
  untimed: Item[]
  /** A day that changes time zone (a flight London → Athens): where it starts and where it ends. The calendar shows one of them. */
  zones?: [string, string]
  /** Noon of the day, so zone labels show that date's offset (summer time), not today's. */
  noonUtc?: number
}

/**
 * The flight out from home or back to it. On the calendar it's only a 15-minute marker in local time: when it lands at the
 * start of the trip, when it leaves at the end. The rest of it happens on another clock and doesn't matter there.
 */
function homeLeg(it: Item, ctx: ZoneCtx): 'out' | 'back' | undefined {
  if (it.kind !== 'flight') return undefined
  if (atHome(ctx.trip, it.from) && !atHome(ctx.trip, it.to)) return 'out'
  if (atHome(ctx.trip, it.to) && !atHome(ctx.trip, it.from)) return 'back'
  return undefined
}

/**
 * The time zones of a day that changes zone during it: the first journey that day leaving one zone, the last one landing
 * in another. The calendar shows the zone you set off from, unless that's home (the trip begins at the destination).
 */
export function dayZones(allItems: Item[], date: ISODate, ctx: ZoneCtx): { zones: [string, string]; shown: string } | undefined {
  const spans = allItems
    .filter((i) => i.date === date && isTransportKind(i.kind) && i.status !== 'skipped' && !homeLeg(i, ctx))
    .map((i) => ({ i, span: transportSpan(i, ctx) }))
    .filter((x): x is { i: Item; span: TransportSpan } => !!x.span && x.span.fromTz !== x.span.toTz)
    .sort((a, b) => a.span.depUtc - b.span.depUtc)
  if (!spans.length) return undefined
  const first = spans[0]
  const last = spans[spans.length - 1]
  const from = first.span.fromTz
  const to = last.span.toTz
  if (from === to) return undefined
  // Same clock in both (Rome and Paris): no change to show.
  if (offsetMin(from, first.span.depUtc) === offsetMin(to, last.span.arrUtc)) return undefined
  return { zones: [from, to], shown: atHome(ctx.trip, first.i.from) ? to : from }
}

const noteOf = (it: Item, span: TransportSpan) => (span.zonesDiffer ? `${it.startTime} ${tzCity(span.fromTz)} → ${it.endTime} ${tzCity(span.toTz)}` : undefined)

/** "22:30 Sydney → 07:00 Tokyo · 10 h 30": a journey across zones in words (nothing when it stays in one zone). */
export function journeyNote(it: Item, ctx: ZoneCtx): string | undefined {
  const span = transportSpan(it, ctx)
  return span?.zonesDiffer ? `${it.startTime} ${tzCity(span.fromTz)} → ${it.endTime} ${tzCity(span.toTz)} · ${formatDuration(span.durationMin * 60)}` : undefined
}

export function buildDayView(allItems: Item[], date: ISODate, zoneCtx: ZoneCtx, showIn?: string): DayView {
  const ctx = { ...zoneCtx, items: zoneCtx.items ?? allItems }
  const change = dayZones(allItems, date, ctx)
  // The calendar's clock: the day's own zone, or on a day that changes zone, the one you set off from (or the one asked for).
  const tz = change ? (showIn && change.zones.includes(showIn) ? showIn : change.shown) : zoneOfDate(date, ctx)
  // Each item's own zone on such a day: where it is (by its coordinates), else before the first journey that day is
  // the zone you set off from, after it the one you arrive in.
  const firstLeg = change && allItems.filter((i) => i.date === date && isTransportKind(i.kind) && i.startTime && i.status !== 'skipped' && itemZones(i, ctx).from === change.zones[0]).sort((a, b) => a.startTime!.localeCompare(b.startTime!))[0]
  const ownZone = (it: Item): string | undefined => {
    if (!change) return undefined
    const at = it.location?.lat != null && it.location.lon != null ? tzAt(it.location.lat, it.location.lon) : undefined
    if (at && change.zones.includes(at)) return at
    // Leaving home, nothing is planned there: what the day has is at the destination.
    if (firstLeg && atHome(ctx.trip, firstLeg.from)) return change.zones[1]
    return firstLeg?.startTime && it.startTime! < firstLeg.startTime ? change.zones[0] : change.zones[1]
  }
  const entries: DayEntry[] = []
  const untimed: Item[] = []
  const mid = tz ? midnight(date, tz) : undefined
  const MIN = 60000
  const later: Item[] = []

  for (const it of allItems.filter((i) => i.date === date)) {
    if (!it.startTime) {
      untimed.push(it)
      continue
    }
    if (tz && mid != null && isTransportKind(it.kind)) {
      const z = itemZones(it, ctx)
      const span = transportSpan(it, ctx)
      const leg = span && homeLeg(it, ctx)
      if (span && leg) {
        // Out from home: only its landing, on the day it lands (tomorrow's calendar if it lands then). Home: its departure.
        const at = ((leg === 'out' ? span.arrUtc : span.depUtc) - mid) / MIN
        if (at >= 0 && at < 24 * 60) entries.push({ item: it, start: at, end: Math.min(at + 15, 24 * 60), marker: leg === 'out' ? 'lands' : 'departs', converted: true, zoneNote: noteOf(it, span) })
        else if (leg === 'back' && at >= 24 * 60) later.push(it)
        continue
      }
      if (span) {
        const start = (span.depUtc - mid) / MIN
        const end = (span.arrUtc - mid) / MIN
        if (start >= 24 * 60) {
          later.push(it) // a connection that really leaves the next day: shown there
          continue
        }
        entries.push({
          item: it,
          start: Math.min(Math.max(start, 0), 24 * 60 - 1),
          end: Math.min(end, 24 * 60),
          clippedStart: start < 0,
          clippedEnd: end > 24 * 60,
          converted: span.fromTz !== tz || span.toTz !== tz,
          zoneNote: noteOf(it, span),
        })
        continue
      }
      if (z.from && z.from !== tz) {
        // Departure only, from another zone: place it where it falls in this day's time.
        const start = (zonedToUtc(date, it.startTime, z.from) - mid) / MIN
        entries.push({ item: it, start: Math.min(Math.max(start, 0), 24 * 60 - 1), converted: true, clippedStart: start < 0 })
        continue
      }
    }
    let end = it.endTime ? hhmmToMin(it.endTime) : undefined
    let start = hhmmToMin(it.startTime)
    if (end != null && end <= start) end = end === start ? undefined : 24 * 60 // runs past midnight (no zone info)
    const own = ownZone(it)
    if (own && tz && own !== tz) {
      // In the other zone of the day: at its real moment on this calendar's clock, and marked.
      const shift = Math.round((offsetMin(own, zonedToUtc(date, it.startTime, own)) - offsetMin(tz, zonedToUtc(date, it.startTime, own))))
      start -= shift
      if (end != null) end -= shift
      // Past midnight (or before it) on this clock: shown at the edge of the day.
      const s0 = Math.min(Math.max(start, 0), 24 * 60 - 1)
      entries.push({ item: it, start: s0, end: end == null ? undefined : Math.min(Math.max(end, s0 + 15), 24 * 60), otherZone: own, shift, clippedStart: start < 0, clippedEnd: start >= 24 * 60 || (end != null && end > 24 * 60) })
      continue
    }
    entries.push({ item: it, start, end })
  }

  // The last day has no next one: if the way home would vanish from it entirely, it shows at the end of the day.
  if (date >= ctx.trip.endDate && later.length && !entries.some((e) => isTransportKind(e.item.kind) && e.item.date === date))
    for (const it of later) entries.push({ item: it, start: 24 * 60 - 15, end: 24 * 60, clippedEnd: true, converted: true, marker: homeLeg(it, ctx) === 'back' ? 'departs' : undefined })

  // Journeys that began the day before and land today.
  if (tz && mid != null) {
    for (const it of allItems.filter((i) => i.date === addDays(date, -1) && isTransportKind(i.kind))) {
      const span = transportSpan(it, ctx)
      const leg = span && homeLeg(it, ctx)
      if (span && leg) {
        const at = (span.arrUtc - mid) / MIN
        if (leg === 'out' && at >= 0 && at < 24 * 60) entries.push({ item: it, start: at, end: Math.min(at + 15, 24 * 60), marker: 'lands', converted: true, zoneNote: noteOf(it, span) })
        continue
      }
      if (span && span.arrUtc > mid) {
        const start = Math.max(0, (span.depUtc - mid) / MIN)
        entries.push({ item: it, start, end: Math.min((span.arrUtc - mid) / MIN, 24 * 60), spill: true, clippedStart: start === 0, converted: span.fromTz !== tz || span.toTz !== tz, zoneNote: noteOf(it, span) })
      }
    }
  }
  return { tz, entries, untimed, zones: change?.zones, noonUtc: tz ? zonedToUtc(date, '12:00', tz) : undefined }
}
