import { describe, expect, it } from 'vitest'
import type { Day, Item, Trip } from '../types'
import { stayStretches, tidyStaysPlan } from './stays'

const trip = { id: 't', startDate: '2027-09-20', endDate: '2027-09-28', startPlace: { name: 'Sydney', lat: -33.87, lon: 151.21 } } as Trip
const day = (date: string, city: string, lat: number, lon: number): Day => ({ id: date, tripId: 't', date, city, lat, lon })
const ROME = [41.9028, 12.4964] as const
const days = [
  day('2027-09-20', 'Florence', 43.7696, 11.2558),
  day('2027-09-21', 'Florence', 43.7696, 11.2558),
  day('2027-09-22', 'Amsterdam', 52.37, 4.895),
  day('2027-09-23', 'Amsterdam', 52.37, 4.895),
  day('2027-09-24', 'Rome', ...ROME),
  day('2027-09-25', 'Rome', ...ROME),
  day('2027-09-26', 'Rome', ...ROME),
  day('2027-09-27', 'Rome', ...ROME),
  day('2027-09-28', 'Rome', ...ROME),
]
const stay = (id: string, date: string, nights: number, over: Partial<Item> = {}) =>
  ({ id, tripId: 't', date, kind: 'stay', title: `Hotel ${id}`, nights, status: 'planned', order: 0, location: { name: 'x', lat: 41.9, lon: 12.47 }, ...over }) as Item

describe("tidying the trip's stays", () => {
  it('groups the nights by city', () => {
    expect(stayStretches(trip, days, []).map((s) => [s.city, s.nights.length])).toEqual([
      ['Florence', 2],
      ['Amsterdam', 2],
      ['Rome', 4],
    ])
  })

  it('merges one-per-night repeats, cuts a stay back to its city, fills a city with none, keeps a booked one', () => {
    const items = [
      stay('f', '2027-09-20', 4, { location: { name: 'Florence hotel', lat: 43.77, lon: 11.25 } }), // runs 2 nights into Amsterdam
      stay('r1', '2027-09-24', 3, { cost: { amount: 600, currency: 'EUR' } }),
      stay('r2', '2027-09-25', 2, { cost: { amount: 400, currency: 'EUR' } }),
      stay('r3', '2027-09-26', 1, { cost: { amount: 200, currency: 'EUR' } }),
    ]
    const { put, remove } = tidyStaysPlan(trip, days, items)
    const byId = new Map(put.map((p) => [p.id, p]))
    expect(byId.get('f')).toMatchObject({ date: '2027-09-20', nights: 2 }) // Florence only
    expect(byId.get('r1')).toMatchObject({ date: '2027-09-24', nights: 4, cost: { amount: 800 } }) // all of Rome, at the average price per night
    expect(remove.sort()).toEqual(['r2', 'r3'])
    const placeholder = put.find((p) => p.title === 'Hotel in Amsterdam (to choose)')!
    expect(placeholder).toMatchObject({ date: '2027-09-22', nights: 2, status: 'idea', location: { lat: 52.37, lon: 4.895 } })

    // Tidying again changes nothing.
    const after = [...items.filter((i) => !remove.includes(i.id) && !byId.has(i.id)), ...put]
    expect(tidyStaysPlan(trip, days, after)).toEqual({ put: [], remove: [] })
  })

  it('a hotel you set yourself stays, and only the other nights of the city are filled', () => {
    const mine = stay('mine', '2027-09-24', 2, { hotelSet: true, title: 'Hotel Raphael' })
    const { put } = tidyStaysPlan(trip, days, [mine])
    expect(put.find((p) => p.id === 'mine')).toBeUndefined()
    expect(put.find((p) => p.title === 'Hotel in Rome (to choose)')).toMatchObject({ date: '2027-09-26', nights: 2 })
  })
})
