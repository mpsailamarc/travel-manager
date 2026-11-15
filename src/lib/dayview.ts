// What the calendar shows for one day: every item as a start and end in minutes, in the day's own (destination) time.
// A flight typed as "22:30 Sydney → 07:00 Tokyo" is placed at its real moments in Tokyo time, and on the next
// morning's calendar it appears again as the part that lands.

import type { Item } from '../types'
import type { ISODate } from '../types'
import { addDays, formatDuration, hhmmToMin } from './dates'
import { isTransportKind, midnight, transportSpan, tzCity, zoneOfDate, zonedToUtc, itemZones, type TransportSpan, type ZoneCtx } from './tz'

export interface DayEntry {
  item: Item
  start: number // minutes from midnight of the day, in the day's zone (0–1440)
  end?: number // undefined = no end time known
  spill?: boolean // the landing part of a journey that started the day before
  clippedStart?: boolean // began before this day's midnight
  clippedEnd?: boolean // continues after this day's midnight
  converted?: boolean // its times were converted from another zone
  zoneNote?: string // "22:30 Sydney → 07:00 Tokyo"
}

export interface DayView {
  tz?: string
  entries: DayEntry[]
  untimed: Item[]
}

const noteOf = (it: Item, span: TransportSpan) => (span.zonesDiffer ? `${it.startTime} ${tzCity(span.fromTz)} → ${it.endTime} ${tzCity(span.toTz)}` : undefined)

/** "22:30 Sydney → 07:00 Tokyo · 10 h 30": a journey across zones in words (nothing when it stays in one zone). */
export function journeyNote(it: Item, ctx: ZoneCtx): string | undefined {
  const span = transportSpan(it, ctx)
  return span?.zonesDiffer ? `${it.startTime} ${tzCity(span.fromTz)} → ${it.endTime} ${tzCity(span.toTz)} · ${formatDuration(span.durationMin * 60)}` : undefined
}

export function buildDayView(allItems: Item[], date: ISODate, zoneCtx: ZoneCtx): DayView {
  const ctx = { ...zoneCtx, items: zoneCtx.items ?? allItems }
  const tz = zoneOfDate(date, ctx)
  const entries: DayEntry[] = []
  const untimed: Item[] = []
  const mid = tz ? midnight(date, tz) : undefined
  const MIN = 60000

  for (const it of allItems.filter((i) => i.date === date)) {
    if (!it.startTime) {
      untimed.push(it)
      continue
    }
    if (tz && mid != null && isTransportKind(it.kind)) {
      const z = itemZones(it, ctx)
      const span = transportSpan(it, ctx)
      if (span) {
        const start = (span.depUtc - mid) / MIN
        const end = (span.arrUtc - mid) / MIN
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
    const start = hhmmToMin(it.startTime)
    if (end != null && end <= start) end = end === start ? undefined : 24 * 60 // runs past midnight (no zone info)
    entries.push({ item: it, start, end })
  }

  // Journeys that began the day before and land today.
  if (tz && mid != null) {
    for (const it of allItems.filter((i) => i.date === addDays(date, -1) && isTransportKind(i.kind))) {
      const span = transportSpan(it, ctx)
      if (span && span.arrUtc > mid) {
        entries.push({ item: it, start: 0, end: Math.min((span.arrUtc - mid) / MIN, 24 * 60), spill: true, clippedStart: true, converted: span.fromTz !== tz || span.toTz !== tz, zoneNote: noteOf(it, span) })
      }
    }
  }
  return { tz, entries, untimed }
}
