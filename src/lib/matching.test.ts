import { describe, expect, it } from 'vitest'
import type { Item } from '../types'
import { isSameItem, matchesPlace } from './duplicates'
import { planRipple } from './ripple'
import { cityIn } from './cities'

const item = (over: Partial<Item>) => ({ id: 'x', tripId: 'T', date: '2027-03-10', kind: 'activity', title: '', status: 'planned', order: 0, ...over }) as Item

describe('is it the same place?', () => {
  it('links a wishlist place to an itinerary item with its name in the title', () => {
    expect(matchesPlace(item({ title: 'Visit the Tower of London' }), { name: 'Tower of London' })).toBe(true)
    expect(matchesPlace(item({ title: 'Belém walk', walk: { stops: [{ name: 'Belém Tower' }] } as unknown as Item['walk'] }), { name: 'Belém Tower' })).toBe(true)
    expect(matchesPlace(item({ title: 'MAAT riverside & playground' }), { name: 'MAAT' })).toBe(true)
  })

  it('links by position when names differ', () => {
    expect(matchesPlace(item({ title: 'Morning at the fortress', location: { name: 'x', lat: 51.5081, lon: -0.0759 } }), { name: 'Tower of London', lat: 51.5082, lon: -0.076 })).toBe(true)
  })

  it('does not link on a generic word, a hotel or a journey', () => {
    expect(matchesPlace(item({ title: 'Natural History Museum' }), { name: 'Museum' })).toBe(false)
    expect(matchesPlace(item({ kind: 'stay', title: 'Hotel near the Tower of London' }), { name: 'Tower of London' })).toBe(false)
    expect(matchesPlace(item({ kind: 'train', title: 'Train to Sintra' }), { name: 'Sintra' })).toBe(false)
  })

  it('spots the same journey entered twice', () => {
    expect(isSameItem({ kind: 'flight', date: 'd', title: 'Flight', startTime: '09:00' }, { kind: 'flight', date: 'd', title: 'TAP TP123 Lisbon–London', startTime: '09:05' })).toBe(true)
    expect(isSameItem({ kind: 'activity', date: 'd', title: 'Louvre' }, { kind: 'activity', date: 'd', title: 'Orsay' })).toBe(false)
  })

  it('recognises well-known cities and airport codes', () => {
    expect(cityIn('Sydney Airport (SYD)')?.name).toBe('Sydney')
    expect(cityIn('Gare de Lyon, Paris')?.name).toBe('Paris')
    expect(cityIn('somewhere unknown')).toBeUndefined()
  })
})

describe('pushing the rest of the day back', () => {
  const day = [
    item({ id: 'a', title: 'Landing', startTime: '06:00', endTime: '06:30' }),
    item({ id: 'b', title: 'Breakfast', startTime: '07:00', endTime: '08:00' }),
    item({ id: 'c', title: 'Museum', startTime: '08:00', endTime: '10:00' }),
    item({ id: 'd', title: 'Booked tour', startTime: '10:30', endTime: '12:00', status: 'booked' }),
  ]

  it('moves only what now overlaps, keeping lengths', () => {
    const r = planRipple(day, { id: 'a', startTime: '06:00', endTime: '07:30' }, { startTime: '06:00', endTime: '06:30' })
    expect(r.moves.map((m) => [m.item.id, m.start, m.end])).toEqual([
      ['b', '07:30', '08:30'],
      ['c', '08:30', '10:30'],
    ])
  })

  it('never pushes past something booked', () => {
    const r = planRipple(day, { id: 'a', startTime: '06:00', endTime: '09:00' }, { startTime: '06:00', endTime: '06:30' })
    expect(r.blockedBy?.id).toBe('d')
  })
})
