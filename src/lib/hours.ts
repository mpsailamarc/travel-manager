// When a place is likely to be open. OpenStreetMap often knows ("Tu-Su 10:00-18:00"); otherwise a sensible guess:
// museums, castles, churches and most sights 9:00–17:00, while parks, viewpoints, markets, walks, meals and evening
// shows have no limit. It can't be exact, so it only steers the planner and warns; it never deletes anything.

import type { ISODate } from '../types'
import { t } from '../i18n'

export interface OpenWindow {
  open: number // minutes from midnight
  close: number
  known: boolean // from the place's published hours (OpenStreetMap), not a guess
}

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const NO_LIMIT = /park|garden|jardim|jard[ií]n|viewpoint|lookout|miradouro|mirador|belvedere|square|plaza|pra[çc]a|piazza|bridge|ponte|beach|praia|street|rua|avenue|walk|hike|trail|stroll|wander|neighbou?rhood|quarter|district|old town|market|mercado|show|concert|fado|theatre|theater|opera|night|bar\b|pub\b|sunset|sunrise|cruise|boat|ferry|river|harbou?r|waterfront|promenade|lake|fountain|statue|monument to|memorial|arch\b|gate\b|cemetery/i
const SHOPS = /shopping|shop\b|shops|mall|boutique/i
const OUTDOOR_CATEGORIES = new Set(['park', 'viewpoint', 'food', 'experience'])
const SIGHT_CATEGORIES = new Set(['museum', 'castle', 'religious', 'attraction', 'family'])

const toMin = (h: string) => {
  const [a, b] = h.split(':').map(Number)
  return a * 60 + (b || 0)
}

/** The day's hours from an OpenStreetMap opening_hours value, for the usual simple forms; undefined when it can't tell. */
export function parseOsmHours(spec: string, date: ISODate): OpenWindow | 'closed' | undefined {
  const s = spec.trim()
  if (!s) return undefined
  if (/^24\/7$/.test(s)) return { open: 0, close: 24 * 60, known: true }
  const dow = DAYS[new Date(date + 'T12:00:00Z').getUTCDay()]
  const dayIn = (days: string) =>
    days.split(',').some((part) => {
      const [a, b] = part.trim().split('-')
      const ia = DAYS.indexOf(a)
      const ib = b ? DAYS.indexOf(b) : ia
      const id = DAYS.indexOf(dow)
      if (ia < 0 || ib < 0) return false
      return ia <= ib ? id >= ia && id <= ib : id >= ia || id <= ib // ranges can wrap: Fr-Mo
    })
  let result: OpenWindow | 'closed' | undefined
  let dayRules = 0 // rules for particular weekdays: if none is for this one, the place is closed that day
  let anyDay = false
  for (const rule of s.split(';').map((r) => r.trim()).filter(Boolean)) {
    const m = rule.match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:[-,](?:Mo|Tu|We|Th|Fr|Sa|Su))*)?\s*(.*)$/)
    if (!m) continue
    const [, days, rest] = m
    if (days) dayRules++
    else anyDay = true
    if (days && !dayIn(days)) continue
    if (/^(off|closed)$/i.test(rest)) {
      result = 'closed'
      continue
    }
    const ranges = [...rest.matchAll(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/g)]
    if (!ranges.length) continue
    const open = Math.min(...ranges.map((r) => toMin(r[1])))
    const close = Math.max(...ranges.map((r) => (toMin(r[2]) <= toMin(r[1]) ? toMin(r[2]) + 24 * 60 : toMin(r[2]))))
    result = { open, close, known: true } // later rules win, as in the OSM format
  }
  if (!result && dayRules > 0 && !anyDay && /\d{1,2}:\d{2}/.test(s)) return 'closed'
  return result
}

/**
 * The likely opening hours of a plan item or wishlist place on a date. Undefined means no limit (a park, a walk, a meal…).
 * 'closed' only comes from published hours that say so for that weekday.
 */
export function openingWindow(x: { title: string; kind?: string; category?: string; hours?: string }, date: ISODate): OpenWindow | 'closed' | undefined {
  if (x.hours) {
    const p = parseOsmHours(x.hours, date)
    if (p) return p
  }
  if (x.kind && x.kind !== 'activity') return undefined // meals, walks, notes, journeys
  if (x.category && OUTDOOR_CATEGORIES.has(x.category)) return undefined
  if (x.category === 'shopping' || SHOPS.test(x.title)) return { open: 10 * 60, close: 19 * 60, known: false }
  if (x.category === 'daytrip') return undefined
  if (x.category === 'monument' && !/tower|torre|castle|castelo|castillo|ch[aâ]teau|schloss|palace|pal[aá]cio|palacio|palazzo|museum|museu|museo|mus[ée]e|house|hall|tomb|monastery|mosteiro/i.test(x.title)) return undefined // statues, columns, squares
  if (!x.category && NO_LIMIT.test(x.title)) return undefined
  if (x.category && !SIGHT_CATEGORIES.has(x.category) && x.category !== 'monument' && NO_LIMIT.test(x.title)) return undefined
  return { open: 9 * 60, close: 17 * 60, known: false }
}

const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** "usually open 9:00–17:00" / "open 10:00–18:00 today" */
export function hoursLabel(w: OpenWindow) {
  return t(w.known ? 'open {from}–{to}' : 'usually open {from}–{to}', { from: hhmm(w.open), to: hhmm(w.close) })
}

/** A warning when the time planned falls outside the likely hours, else nothing. */
export function hoursWarning(x: { title: string; kind?: string; category?: string; hours?: string; startTime?: string; endTime?: string }, date: ISODate): string | undefined {
  if (!x.startTime) return undefined
  const w = openingWindow(x, date)
  if (!w) return undefined
  if (w === 'closed') return t('closed that day (published hours)')
  const s = toMin(x.startTime)
  const e = x.endTime ? toMin(x.endTime) : s + 60
  if (s < w.open || e > w.close) return t('may be closed then: {hours}', { hours: hoursLabel(w) })
  return undefined
}
