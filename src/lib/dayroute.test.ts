import { describe, expect, it } from 'vitest'
import type { Item } from '../types'
import { buildRoute, dayStartPlace, routeItems } from './dayroute'
import { SETTINGS } from '../test/fixtures'

const it_ = (o: Partial<Item>) => ({ tripId: 't', status: 'planned', order: 0, ...o }) as Item

describe("the day's path on the map", () => {
  it('starts where you slept, goes through the car pick-up and the drives, and leaves untimed things off the path', async () => {
    const items = [
      it_({ id: 'h', date: '2027-07-14', kind: 'stay', title: 'Hotel in Athens', nights: 2, location: { name: 'Hotel', lat: 37.9715, lon: 23.7295 } }),
      it_({ id: 'c', date: '2027-07-16', kind: 'car', title: 'Pick up rental car in Athens', startTime: '08:00' }),
      it_({ id: 'd', date: '2027-07-16', kind: 'drive', title: 'Drive to Corinth', startTime: '09:00', from: { name: 'Athens' }, to: { name: 'Ancient Corinth', lat: 37.9057, lon: 22.8787 } }),
      it_({ id: 'v', date: '2027-07-16', kind: 'activity', title: 'Ancient Corinth', startTime: '10:30', location: { name: 'Corinth', lat: 37.906, lon: 22.879 } }),
      it_({ id: 'u', date: '2027-07-16', kind: 'meal', title: 'Dinner somewhere', location: { name: 'Nafplio', lat: 37.562, lon: 22.808 } }),
    ]
    const D = '2027-07-16'
    const begin = dayStartPlace(items, D)
    expect(begin?.name).toBe('Hotel in Athens') // last night's hotel, not tonight's
    const r = await buildRoute(routeItems(items, D), 'car', SETTINGS, begin)
    expect(r.start?.name).toBe('Hotel in Athens')
    expect(r.stops.map((s) => s.item.id)).toEqual(['c', 'd', 'v', 'u'])
    expect(r.stops[0].leg?.fromName).toBe('Hotel in Athens') // to the rental office
    expect(r.stops[1].leg?.mode).toBe('drive')
    expect(r.stops[3].leg).toBeUndefined() // no time yet: shown, but not on the path
  })

  it('a flight is the drive to its airport, a straight line to where it lands, then on from there', async () => {
    const items = [
      it_({ id: 'h', date: '2027-02-05', kind: 'stay', title: 'Hotel in San Pedro', nights: 1, location: { name: 'Hotel', lat: -22.9083, lon: -68.1994 } }),
      it_({ id: 'd', date: '2027-02-06', kind: 'drive', title: 'Drive to Calama airport', startTime: '06:30', endTime: '08:00', from: { name: 'San Pedro de Atacama' }, to: { name: 'Calama airport (CJC)', lat: -22.4982, lon: -68.9036 } }),
      it_({ id: 'f', date: '2027-02-06', kind: 'flight', title: 'Flight CJC → SCL', startTime: '11:00', endTime: '13:00', from: { name: 'Calama (CJC)', lat: -22.4982, lon: -68.9036 }, to: { name: 'Santiago (SCL)', lat: -33.393, lon: -70.7858 } }),
      it_({ id: 'w', date: '2027-02-06', kind: 'walk', title: 'Cerro Santa Lucía', startTime: '16:00', location: { name: 'Cerro Santa Lucía', lat: -33.4404, lon: -70.6439 } }),
    ]
    const D = '2027-02-06'
    const r = await buildRoute(routeItems(items, D), 'car', SETTINGS, dayStartPlace(items, D))
    expect(r.stops.map((s) => s.item.id)).toEqual(['d', 'f', 'w'])
    expect(r.stops[0].leg?.mode).toBe('drive')
    expect(r.stops[1].access).toBeUndefined() // already at the airport
    expect(r.stops[1].leg).toMatchObject({ mode: 'flight', geometry: [[-68.9036, -22.4982], [-70.7858, -33.393]] })
    expect(r.stops[2].leg?.fromName).toBe('Flight CJC → SCL') // on from where it landed, not from San Pedro
    expect(r.segments.find((s) => s.dashed && s.coords.length === 2)).toBeTruthy()
  })
})
