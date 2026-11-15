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

describe('flying Sydney → Santiago and driving the next morning', () => {
  const chile = { id: 'C', startDate: '2027-01-01', endDate: '2027-01-10', countryCodes: ['CL'], startPlace: { name: 'Sydney', lat: -33.87, lon: 151.21 } } as Trip
  const cdays = [
    { id: 'C:1', tripId: 'C', date: '2027-01-01', city: 'Sydney', lat: -33.87, lon: 151.21 },
    { id: 'C:2', tripId: 'C', date: '2027-01-02', city: 'Santiago', lat: -33.45, lon: -70.67 },
  ]
  const c = { trip: chile, days: cdays }
  const sydSantiago = flight({ tripId: 'C', date: '2027-01-01', startTime: '09:00', endTime: '23:00', from: { name: 'Sydney', lat: -33.94, lon: 151.18 }, to: { name: 'Santiago (SCL)', lat: -33.39, lon: -70.79 } })

  it('never makes the flight quicker than a plane can fly: the 23:00 landing is the same date, 28 hours later', () => {
    const span = transportSpan(sydSantiago, c)!
    expect(span.durationMin).toBe(28 * 60) // not the 4 hours the date line would allow
    expect(span.arrDate).toBe('2027-01-01')
  })

  it('a drive the next day is on Santiago time, not Sydney time', () => {
    const drive = { id: 'd', tripId: 'C', date: '2027-01-02', kind: 'drive', title: 'Drive to the airport', status: 'planned', order: 1, startTime: '10:00', endTime: '10:30', from: { name: 'Hotel' }, to: { name: 'Somewhere' } } as Item
    expect(itemZones(drive, c)).toMatchObject({ from: 'America/Santiago', to: 'America/Santiago' })
    expect(buildDayView([drive], '2027-01-02', c).entries[0]).toMatchObject({ start: 600, end: 630 })
  })
})

describe('a day out by a border', () => {
  it('keeps the zone of the days around it (El Tatio, next to Bolivia, is on Chile time)', async () => {
    const { zoneOfDate } = await import('./tz')
    const t = { id: 'C', startDate: '2027-02-04', endDate: '2027-02-06', countryCodes: ['CL'] } as Trip
    const d = (date: string, city: string, lat: number, lon: number) => ({ id: date, tripId: 'C', date, city, lat, lon })
    const ds = [d('2027-02-04', 'San Pedro de Atacama', -22.9083, -68.1994), d('2027-02-05', 'El Tatio', -22.337, -68.01), d('2027-02-06', 'San Pedro de Atacama', -22.9083, -68.1994)]
    expect(zoneOfDate('2027-02-05', { trip: t, days: ds })).toBe('America/Santiago')
  })
})

describe('the flight from home on a day 1 already at the destination', () => {
  const eu = { id: 'E', startDate: '2027-07-01', endDate: '2027-07-14', countryCodes: ['GB'], startPlace: { name: 'Sydney', lat: -33.87, lon: 151.21 } } as Trip
  const edays = [{ id: 'E:1', tripId: 'E', date: '2027-07-01', city: 'London', lat: 51.5074, lon: -0.1278 }]
  const syd = { id: 's', tripId: 'E', date: '2027-07-01', kind: 'flight', title: 'Sydney (SYD) → London (LHR)', status: 'planned', order: 0, startTime: '09:00', endTime: '09:00', from: { name: 'Sydney (SYD)' }, to: { name: 'London (LHR)' } } as Item
  const southBank = { id: 'w', tripId: 'E', date: '2027-07-01', kind: 'walk', title: 'South Bank stroll', status: 'planned', order: 1, startTime: '10:05', endTime: '12:45' } as Item

  it('lands that morning when day 1 is planned in London, so nothing clashes', () => {
    const v = buildDayView([syd, southBank], '2027-07-01', { trip: eu, days: edays })
    const f = v.entries.find((e) => e.item.id === 's')!
    expect(f).toMatchObject({ start: 0, end: 9 * 60, clippedStart: true })
  })

  it('with nothing else planned on day 1, it leaves that day and lands the next', () => {
    expect(transportSpan(syd, { trip: eu, days: edays, items: [syd] })!.arrDate).toBe('2027-07-02')
  })
})

describe('reading place names', () => {
  it('reads airport codes only where they are written as codes', async () => {
    const { cityIn } = await import('./cities')
    expect(cityIn('SEA LIFE London Aquarium')?.name).not.toBe('Seattle')
    expect(cityIn('Sydney Airport (SYD)')?.name).toBe('Sydney')
    expect(cityIn('Flight SYD → LHR')).toBeTruthy()
    expect(cityIn('Paris (CDG/ORY)')?.name).toBe('Paris')
  })
})

describe('the way home: Rome → Dubai → Sydney, both listed on the last day', () => {
  const t = { id: 'R', startDate: '2027-09-20', endDate: '2027-09-28', countryCodes: ['IT'], startPlace: { name: 'Sydney', lat: -33.87, lon: 151.21 } } as Trip
  const ds = [{ id: 'R:28', tripId: 'R', date: '2027-09-28', city: 'Rome', lat: 41.9028, lon: 12.4964 }]
  const leg = (id: string, title: string, s: string, e: string, from: [string, number, number], to: [string, number, number]) =>
    ({ id, tripId: 'R', date: '2027-09-28', kind: 'flight', title, status: 'planned', order: 0, startTime: s, endTime: e, from: { name: from[0], lat: from[1], lon: from[2] }, to: { name: to[0], lat: to[1], lon: to[2] } }) as Item
  const rome = leg('a', 'Rome FCO → Dubai DXB', '19:30', '05:10', ['Fiumicino (FCO)', 41.8, 12.25], ['Dubai International (DXB)', 25.25, 55.36])
  const dubai = leg('b', 'Dubai DXB → Sydney SYD', '08:00', '07:10', ['Dubai International Airport (DXB)', 25.25, 55.36], ['Sydney (SYD)', -33.94, 151.18])

  it('the connection leaves Dubai after the first flight has landed there', () => {
    const ctx = { trip: t, days: ds, items: [rome, dubai] }
    const first = transportSpan(rome, ctx)!
    const second = transportSpan(dubai, ctx)!
    expect(second.depUtc).toBeGreaterThan(first.arrUtc)
    expect(new Date(second.depUtc).toISOString()).toBe('2027-09-29T04:00:00.000Z') // 08:00 in Dubai on the 29th
  })

  it("so the last day's calendar shows only the flight out of Rome", () => {
    const v = buildDayView([rome, dubai], '2027-09-28', { trip: t, days: ds })
    expect(v.entries.map((e) => e.item.id)).toEqual(['a'])
  })
})
