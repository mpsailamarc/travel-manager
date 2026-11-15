import { describe, expect, it } from 'vitest'
import { db } from '../db'
import { exportTrip, importTrip } from './share'
import { addFav, addItem, at, LONDON, makeTrip } from '../test/fixtures'
import { budgetFromLines, inferAssumption, lineAmount } from './budget'

describe('sharing a trip as a file', () => {
  it('imports as a new copy with the wishlist still linked to its plan items', async () => {
    const trip = await makeTrip({ name: 'Shared' })
    const item = await addItem(trip, { date: trip.startDate, title: 'Tower of London', planner: 'fav:london' })
    const fav = await addFav(trip, { ...at(LONDON.tower), date: trip.startDate })
    await db.items.update(item.id, { favId: fav.id })
    const linked = await addItem(trip, { date: trip.startDate, title: 'Lunch' })
    await addFav(trip, { name: 'Lunch spot', itemId: linked.id, date: trip.startDate })

    const file = await exportTrip(trip.id, { documents: false, expenses: true })
    const newId = await importTrip(await file.text())
    expect(newId).not.toBe(trip.id)
    const items = await db.items.where('tripId').equals(newId).toArray()
    const favs = await db.favorites.where('tripId').equals(newId).toArray()
    const tower = items.find((i) => i.title === 'Tower of London')!
    expect(favs.find((f) => f.name === 'Tower of London')!.id).toBe(tower.favId) // the item still points at its place
    expect(favs.find((f) => f.name === 'Lunch spot')!.itemId).toBe(items.find((i) => i.title === 'Lunch')!.id)
    expect(items.every((i) => !(i.id === item.id))).toBe(true) // fresh ids: importing twice never overwrites
  })
})

describe('budget lines', () => {
  it('works out quantity × price and keeps a typed amount otherwise', () => {
    expect(lineAmount({ id: 'a', category: 'stays', label: '3 nights', amount: 0, qty: 3, price: 120 })).toBe(360)
    expect(lineAmount({ id: 'b', category: 'food', label: 'Food', amount: 250 })).toBe(250)
  })

  it('reads a quantity × price back from an older line label', () => {
    const l = inferAssumption({ id: 'c', category: 'stays', label: '3 nights × €120', amount: 360 })
    expect(l).toMatchObject({ qty: 3, price: 120 })
  })

  it('category totals follow the lines', () => {
    const lines = [
      { id: 'a', category: 'stays' as const, label: 'x', amount: 300 },
      { id: 'b', category: 'stays' as const, label: 'y', amount: 60 },
      { id: 'c', category: 'food' as const, label: 'z', amount: 100 },
    ]
    expect(budgetFromLines(lines, {})).toMatchObject({ stays: 360, food: 100 })
  })
})

describe('the budget follows the group and the dates', () => {
  it('more travellers: per-person lines, flights and rooms grow; typed amounts stay', async () => {
    const { adjustLinesToTrip, estimateBudgetLines } = await import('./budget')
    const adult = (id: string) => ({ id, name: id, type: 'adult' as const })
    const two = await makeTrip({ travellers: [adult('a'), adult('b')], countryCodes: ['GR'] })
    const { lines } = await estimateBudgetLines(two, 'FR', 'EUR')
    const typed = { id: 'own', category: 'other' as const, label: 'Souvenirs', amount: 100 }
    const four = { ...two, travellers: [adult('a'), adult('b'), adult('c'), adult('d')] }
    const after = adjustLinesToTrip([...lines, typed], two, four)
    const find = (ls: typeof lines, re: RegExp) => ls.find((l) => re.test(l.label))!
    expect(find(after, /^Flights/).qty).toBe(4)
    expect(find(after, /^Food/).amount).toBeCloseTo(find(lines, /^Food/).amount * 2, -1)
    expect(find(after, /^Food/).label).toContain('4 adults')
    expect(find(after, /^Accommodation/).label).toContain('2 rooms')
    expect(find(after, /^Accommodation/).amount).toBeGreaterThan(find(lines, /^Accommodation/).amount * 1.8)
    expect(after.find((l) => l.id === 'own')).toEqual(typed)
  })

  it('a longer trip: more nights and more days of food', async () => {
    const { adjustLinesToTrip, estimateBudgetLines } = await import('./budget')
    const trip = await makeTrip({ travellers: [{ id: 'a', name: 'a', type: 'adult' }], countryCodes: ['GR'] })
    const { lines } = await estimateBudgetLines(trip, 'FR', 'EUR')
    const longer = { ...trip, endDate: '2027-03-15' } // 3 days → 6 days
    const after = adjustLinesToTrip(lines, trip, longer)
    expect(after.find((l) => /^Accommodation/.test(l.label))!.qty).toBe(5)
    expect(after.find((l) => /^Food/.test(l.label))!.qty).toBe(6)
  })
})

describe('the estimate makes sense for where you start', () => {
  it('flying in and renting a car: fuel is not "from" home; driving from home: it is', async () => {
    const { estimateBudgetLines } = await import('./budget')
    const adult = { id: 'a', name: 'a', type: 'adult' as const }
    const car = [{ id: 'c', tripId: 'x', date: '2027-03-10', kind: 'car', title: 'Pick up the car', status: 'booked', order: 0 }] as never[]
    const fromSydney = await makeTrip({ travellers: [adult], countryCodes: ['US'], startPlace: { name: 'Sydney', lat: -33.87, lon: 151.21, country: 'AU' } })
    const flying = await estimateBudgetLines(fromSydney, 'AU', 'AUD', car)
    expect(flying.lines.map((l) => l.label)).toContain('Fuel')
    expect(flying.lines.some((l) => /^Flights/.test(l.label))).toBe(true)
    const fromSF = await makeTrip({ travellers: [adult], countryCodes: ['US'], startPlace: { name: 'San Francisco', lat: 37.77, lon: -122.42, country: 'US' } })
    const driving = await estimateBudgetLines(fromSF, 'US', 'USD', car)
    expect(driving.lines.map((l) => l.label)).toContain('Fuel (from San Francisco)')
    expect(driving.lines.some((l) => /^Flights/.test(l.label))).toBe(false)
  })
})
