import type { HHMM, ISODate } from '../types'

export function toISODate(d: Date): ISODate {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseISODate(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function today(): ISODate {
  return toISODate(new Date())
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = parseISODate(s)
  d.setDate(d.getDate() + n)
  return toISODate(d)
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86_400_000)
}

export function dateRange(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d)
  return out
}

export function formatDate(s: ISODate, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return parseISODate(s).toLocaleDateString(undefined, opts)
}

export function formatRange(start: ISODate, end: ISODate) {
  const sameYear = start.slice(0, 4) === end.slice(0, 4)
  const a = formatDate(start, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
  const b = formatDate(end, { day: 'numeric', month: 'short', year: 'numeric' })
  return `${a} – ${b}`
}

export function nowHHMM(): HHMM {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function hhmmToMin(t: HHMM): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export function minToHHMM(min: number): HHMM {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export function formatDuration(seconds: number): string {
  const min = Math.round(seconds / 60)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const r = min % 60
  return r ? `${h} h ${r} min` : `${h} h`
}
