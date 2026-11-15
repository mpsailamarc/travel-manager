import { describe, expect, it } from 'vitest'
import type { Item, Trip } from '../types'
import { itemZones, transportSpan, tzOfPlace, zonedToUtc } from './tz'
import { buildDayView } from './dayview'

const trip = { id: 'T', startDate: '2027-03-10', endDate: '2027-03-20', countryCodes: ['JP'], startPlace: { name: 'Sydney', lat: -33.87, lon: 151.21 } } as Trip
const days = [
  { id: 'T:2027-03-10', tripId: 'T', date: '2027-03-10', city: 'Tokyo', lat: 35.68, lon: 139.69 },
  { id: 'T:2027-03-11', tripId: 'T', date: '2027-03-11', city: 'Tokyo', lat: 35.68, lon: 139.69 },
]
const ctx = { trip, days }
const flight = (over: Partial<Item> = {}) =>
  ({ id: 'f', tripId: 'T', date: '2027-03-10', kind: 'flight', title: 'Flight', status: 'booked', order: 0, startTime: '22:30', endTime: '07:00', from: { name: 'Sydney', lat: -33.87, lon: 151.21 }, to: { name: 'Tokyo Narita', lat: 35.77, lon: 140.39 }, ...over }) as Item

describe('time zones', () => {
  it('turns a local clock time into the right instant', () => {
    // 10 March 2027: Sydney is on daylight time (UTC+11), so 22:30 there is 11:30 UTC.
    expect(new Date(zonedToUtc('2027-03-10', '22:30', 'Australia/Sydney')).toISOString()).toBe('2027-03-10T11:30:00.000Z')
    expect(new Date(zonedToUtc('2027-03-10', '07:00', 'Asia/Tokyo')).toISOString()).toBe('2027-03-09T22:00:00.000Z')
  })

  it('works out a flight in the departure and arrival zones', () => {
    const span = transportSpan(flight(), ctx)!
    expect(span.fromTz).toBe('Australia/Sydney')
    expect(span.toTz).toBe('Asia/Tokyo')
    expect(span.durationMin).toBe(630) // 10 h 30
    expect(span.arrDate).toBe('2027-03-11') // lands the next morning
  })

  it('finds the zone of a place typed by name, without coordinates', () => {
    expect(tzOfPlace({ name: 'Sydney Airport (SYD)' })).toBe('Australia/Sydney')
    expect(tzOfPlace({ name: 'Narita (NRT)' })).toBe('Asia/Tokyo')
    expect(itemZones(flight({ from: { name: 'Sydney' }, to: { name: 'Tokyo' } }), ctx).from).toBe('Australia/Sydney')
  })

  it('an override wins over what the places say', () => {
    expect(itemZones(flight({ fromTz: 'Pacific/Auckland' }), ctx).from).toBe('Pacific/Auckland')
  })

  it('shows the flight on the destination calendar, and its landing on the next day', () => {
    const d1 = buildDayView([flight()], '2027-03-10', ctx)
    expect(d1.tz).toBe('Asia/Tokyo')
    expect(d1.entries[0].start).toBe(20 * 60 + 30) // 22:30 Sydney = 20:30 Tokyo
    const d2 = buildDayView([flight()], '2027-03-11', ctx)
    expect(d2.entries[0]).toMatchObject({ start: 0, end: 7 * 60, spill: true })
  })
})
