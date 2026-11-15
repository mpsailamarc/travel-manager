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
