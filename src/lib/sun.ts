// Sunrise and sunset, worked out on the device (the usual NOAA approximation, good to a minute or two): so "sunset
// photography" is planned for the evening, not 10:30 in the morning.

import type { ISODate } from '../types'
import { zonedToUtc } from './tz'

const RAD = Math.PI / 180
const J2000 = 2451545
const fromJulian = (j: number) => (j - 2440587.5) * 86_400_000

/** Sunrise and sunset on a date at a place, as instants (ms); nothing in polar day or night. */
export function sunTimes(date: ISODate, lat: number, lon: number): { rise: number; set: number } | undefined {
  const jd = Date.parse(`${date}T12:00:00Z`) / 86_400_000 + 2440587.5
  const n = Math.round(jd - J2000 - 0.0008 - lon / 360)
  const jStar = n + 0.0008 - lon / 360
  const m = (357.5291 + 0.98560028 * jStar) % 360
  const c = 1.9148 * Math.sin(m * RAD) + 0.02 * Math.sin(2 * m * RAD) + 0.0003 * Math.sin(3 * m * RAD)
  const lambda = (m + c + 180 + 102.9372) % 360
  const transit = J2000 + jStar + 0.0053 * Math.sin(m * RAD) - 0.0069 * Math.sin(2 * lambda * RAD)
  const decl = Math.asin(Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD))
  const cosH = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * Math.sin(decl)) / (Math.cos(lat * RAD) * Math.cos(decl))
  if (cosH < -1 || cosH > 1) return undefined
  const h = Math.acos(cosH) / RAD / 360
  return { rise: fromJulian(transit - h), set: fromJulian(transit + h) }
}

/** Sunrise and sunset as minutes on the local clock of `tz` that day. */
export function sunClock(date: ISODate, lat: number, lon: number, tz: string): { rise: number; set: number } | undefined {
  const s = sunTimes(date, lat, lon)
  if (!s) return undefined
  const mid = zonedToUtc(date, '00:00', tz)
  const local = (t: number) => Math.round((t - mid) / 60000)
  return { rise: local(s.rise), set: local(s.set) }
}
