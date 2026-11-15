import { describe, expect, it } from 'vitest'
import { adoptPlannerItems, db, deleteItem, extendTripDays } from '../db'
import { applyCityPlan, reconcileTrip } from './favorites'
import { applyDayReplan } from './ai'
import { mergeGroups, findDuplicateGroups } from './duplicates'
import { addFav, addItem, at, dayItems, LONDON, makeTrip, SETTINGS } from '../test/fixtures'

const [D1, D2, D3] = ['2027-03-10', '2027-03-11', '2027-03-12']

/** A London trip with the Tower planned on day 2 by the City planner. */
async function plannedTrip() {
  const trip = await makeTrip()
  const fav = await addFav(trip, { ...at(LONDON.tower), category: 'castle', visitMin: 90, date: D2, pinned: true })
  await applyCityPlan(trip, 'London', [D2], SETTINGS)
  const item = (await dayItems(trip, D2)).find((i) => i.favId === fav.id)!
  return { trip, fav, item }
}

describe('wishlist, days and calendar stay in step', () => {
  it("when a day changes city, its planned places leave the calendar and go back to the wishlist's backups", async () => {
    const { trip, fav, item } = await plannedTrip()
    await db.days.update(`${trip.id}:${D2}`, { city: 'Oxford', lat: 51.752, lon: -1.2577 })
    expect(await reconcileTrip(trip.id)).toEqual(['Tower of London'])
    expect(await db.items.get(item.id)).toBeUndefined()
    expect((await db.favorites.get(fav.id))!.date).toBeUndefined()
  })

  it('when the trip gets shorter, places on the days that left go back to the backups', async () => {
    const { trip, fav } = await plannedTrip()
    await db.trips.update(trip.id, { endDate: D1 })
    await reconcileTrip(trip.id)
    expect((await dayItems(trip, D2)).filter((i) => i.planner)).toHaveLength(0)
    expect((await db.favorites.get(fav.id))!.date).toBeUndefined()
  })

  it('a place you changed by hand is yours: it follows its item, and re-planning leaves it alone', async () => {
    const { trip, fav, item } = await plannedTrip()
    await db.items.update(item.id, { date: D3 })
    await adoptPlannerItems([item.id])
    expect(await db.favorites.get(fav.id)).toMatchObject({ itemId: item.id, date: D3 })
    await applyCityPlan(trip, 'London', [D2, D3], SETTINGS)
    expect((await db.items.where('tripId').equals(trip.id).toArray()).filter((i) => i.title === 'Tower of London')).toHaveLength(1)
  })

  it('deleting a planned place sends it back to the backups (and it is not planned again)', async () => {
    const { trip, fav, item } = await plannedTrip()
    await deleteItem(item.id)
    expect((await db.favorites.get(fav.id))!.date).toBeUndefined()
    await reconcileTrip(trip.id)
    expect((await dayItems(trip, D2)).filter((i) => i.planner)).toHaveLength(0)
  })

  it("a day replanned by the chatbot keeps its new plan: the replaced places don't come back", async () => {
    const { trip, fav } = await plannedTrip()
    await applyDayReplan(trip, D2, [], [{ kind: 'activity', title: 'Rainy-day museum', time: '10:00' }], 'EUR')
    expect((await db.favorites.get(fav.id))!.date).toBeUndefined()
    await reconcileTrip(trip.id)
    expect((await dayItems(trip, D2)).map((i) => i.title)).toEqual(['Rainy-day museum'])
  })

  it('a place due on a day but missing from the calendar is filled in', async () => {
    const trip = await makeTrip()
    await addFav(trip, { ...at(LONDON.gallery), category: 'museum', visitMin: 90, date: D2, pinned: true })
    await reconcileTrip(trip.id)
    expect((await dayItems(trip, D2)).filter((i) => i.planner)).toHaveLength(1)
  })

  it('running it again changes nothing', async () => {
    const { trip } = await plannedTrip()
    await reconcileTrip(trip.id)
    const before = JSON.stringify(await db.items.where('tripId').equals(trip.id).sortBy('id'))
    const favsBefore = JSON.stringify(await db.favorites.where('tripId').equals(trip.id).sortBy('id'))
    expect(await reconcileTrip(trip.id)).toEqual([])
    expect(JSON.stringify(await db.items.where('tripId').equals(trip.id).sortBy('id'))).toBe(before)
    expect(JSON.stringify(await db.favorites.where('tripId').equals(trip.id).sortBy('id'))).toBe(favsBefore)
  })

  it('adding the same place yourself (a booked ticket) replaces the planned copy, and the wishlist follows yours', async () => {
    const { trip, fav } = await plannedTrip()
    const ticket = await addItem(trip, { date: D2, title: 'Tower of London tickets', status: 'booked', bookingRef: 'TOL-1', startTime: '10:00', endTime: '12:00' })
    await reconcileTrip(trip.id)
    expect((await dayItems(trip, D2)).filter((i) => /Tower of London/.test(i.title)).map((i) => i.id)).toEqual([ticket.id])
    expect((await db.favorites.get(fav.id))!.itemId).toBe(ticket.id)
  })

  it('merging two copies of an item keeps the wishlist place linked to the one kept', async () => {
    const trip = await makeTrip()
    const a = await addItem(trip, { date: D2, title: 'Tower of London', startTime: '10:00' })
    const b = await addItem(trip, { date: D2, title: 'Visit the Tower of London', status: 'booked', bookingRef: 'X1', startTime: '10:00' })
    const fav = await addFav(trip, { ...at(LONDON.tower), date: D2, itemId: a.id, pinned: true })
    await mergeGroups(trip.id, findDuplicateGroups(await db.items.where('tripId').equals(trip.id).toArray()))
    const left = await dayItems(trip, D2)
    expect(left.map((i) => i.id)).toEqual([b.id])
    expect((await db.favorites.get(fav.id))!.itemId).toBe(b.id)
  })

  it('days added by stretching the trip carry on from the neighbouring city', async () => {
    const trip = await makeTrip()
    await db.trips.update(trip.id, { endDate: '2027-03-14' })
    await extendTripDays(trip.id, trip, { startDate: trip.startDate, endDate: '2027-03-14' })
    const added = await db.days.where('tripId').equals(trip.id).filter((d) => d.date > D3).toArray()
    expect(added.map((d) => d.city)).toEqual(['London', 'London'])
  })
})
