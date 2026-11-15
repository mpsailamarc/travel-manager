import { describe, expect, it } from 'vitest'
import { db } from '../db'
import type { Item } from '../types'
import { applyCityPlan, applyProposal, linkWishlistToPlan, proposeDay, retimeAfter } from './favorites'
import { addFav, addItem, at, dayItems, LONDON, makeTrip, mins, SETTINGS } from '../test/fixtures'
import { hoursWarning } from './hours'

const D = '2027-03-11' // a Thursday, the middle day of the test trip (all three days in London)

/** Nothing timed on the day overlaps anything else (stays don't count: they last all night). */
function noOverlaps(items: Item[]) {
  const timed = items.filter((i) => i.startTime && i.status !== 'skipped' && i.kind !== 'stay').sort((a, b) => a.startTime!.localeCompare(b.startTime!))
  for (let k = 1; k < timed.length; k++) {
    const prevEnd = mins(timed[k - 1].endTime ?? timed[k - 1].startTime)
    expect(mins(timed[k].startTime), `${timed[k].title} starts before ${timed[k - 1].title} ends`).toBeGreaterThanOrEqual(prevEnd)
  }
}
const quarterHours = (items: Item[]) => items.filter((i) => i.startTime && i.kind !== 'stay' && i.status !== 'booked').every((i) => mins(i.startTime) % 15 === 0)

/**
 * East, west, east, booked visit, west. With `open` the places are gardens (no opening hours) so only travel counts;
 * otherwise they are sights with 9–17 hours.
 */
async function zigzagDay(open = false) {
  const trip = await makeTrip()
  await addItem(trip, { kind: 'stay', title: 'Hotel', status: 'booked', date: '2027-03-10', nights: 3, location: at(LONDON.hotel) })
  const name = (n: string) => (open ? `${n} gardens` : n)
  const items = {
    tower: await addItem(trip, { date: D, title: name('Tower of London'), startTime: '09:30', endTime: '11:00', location: at(LONDON.tower) }),
    nhm: await addItem(trip, { date: D, title: name('Natural History Museum'), startTime: '11:30', endTime: '13:00', location: at(LONDON.nhm) }),
    stPauls: await addItem(trip, { date: D, title: name("St Paul's Cathedral"), startTime: '13:30', endTime: '14:30', location: at(LONDON.stPauls) }),
    abbey: await addItem(trip, { date: D, title: 'Westminster Abbey', status: 'booked', startTime: '15:00', endTime: '16:00', location: at(LONDON.abbey) }),
    kensington: await addItem(trip, { date: D, title: name('Kensington Palace'), startTime: '16:30', endTime: '18:00', location: at(LONDON.kensington) }),
  }
  return { trip, items }
}

describe('Optimise this day', () => {
  it('cuts travel on a zig-zag day and keeps the booked visit where it is', async () => {
    const { trip, items } = await zigzagDay(true)
    const p = (await proposeDay(trip.id, D, SETTINGS))!
    expect(p.travelAfter).toBeLessThan(p.travelBefore)
    expect(p.changes.some((c) => c.item.id === items.abbey.id)).toBe(false)
    await applyProposal(p)
    const after = await dayItems(trip, D)
    expect(after.find((i) => i.id === items.abbey.id)).toMatchObject({ startTime: '15:00', endTime: '16:00' })
    noOverlaps(after)
    expect(quarterHours(after)).toBe(true)
    // The two east-side places (Tower, St Paul's) end up next to each other.
    const order = after.filter((i) => i.kind === 'activity').map((i) => i.id)
    expect(Math.abs(order.indexOf(items.tower.id) - order.indexOf(items.stPauls.id))).toBe(1)
  })

  it('on an over-full day, fills the time before the booked visit with what fits and keeps it clear of the visit', async () => {
    // Four 1–1.5 h sights and a booked 15:00 visit don't all fit in 9–17. The west pair fits before 15:00 (with the trip to
    // the Abbey); the east pair goes after it. Nothing may run into the booked visit, not even by a few minutes.
    const { trip, items } = await zigzagDay()
    await applyProposal((await proposeDay(trip.id, D, SETTINGS))!)
    const after = await dayItems(trip, D)
    noOverlaps(after)
    const beforeAbbey = after.filter((i) => i.kind === 'activity' && mins(i.endTime) <= 15 * 60).map((i) => i.id)
    expect(beforeAbbey.sort()).toEqual([items.kensington.id, items.nhm.id].sort())
    // Only what comes after the booked visit can be past closing time.
    for (const i of after.filter((i) => hoursWarning(i, D))) expect(mins(i.startTime)).toBeGreaterThanOrEqual(16 * 60)
  })

  it('never moves a 📌 locked item', async () => {
    const { trip, items } = await zigzagDay()
    await db.items.update(items.kensington.id, { locked: true })
    await applyProposal((await proposeDay(trip.id, D, SETTINGS))!)
    expect(await db.items.get(items.kensington.id)).toMatchObject({ startTime: '16:30', endTime: '18:00' })
    noOverlaps(await dayItems(trip, D))
  })

  it('keeps sights inside their opening hours when there is room', async () => {
    const trip = await makeTrip()
    const tower = await addItem(trip, { date: D, title: 'Tower of London', startTime: '19:00', endTime: '20:30', location: at(LONDON.tower) })
    await applyProposal((await proposeDay(trip.id, D, SETTINGS))!)
    const t = (await db.items.get(tower.id))!
    expect(mins(t.startTime)).toBeGreaterThanOrEqual(9 * 60)
    expect(mins(t.endTime)).toBeLessThanOrEqual(17 * 60)
  })

  it('puts lunch around noon and dinner in the evening', async () => {
    const trip = await makeTrip()
    await addItem(trip, { date: D, title: 'Tower of London', startTime: '09:30', endTime: '11:00', location: at(LONDON.tower) })
    await addItem(trip, { date: D, title: "St Paul's Cathedral", startTime: '11:30', endTime: '12:30', location: at(LONDON.stPauls) })
    const lunch = await addItem(trip, { date: D, kind: 'meal', title: 'Lunch somewhere nice' })
    const dinner = await addItem(trip, { date: D, kind: 'meal', title: 'Dinner at Borough Market', startTime: '10:00', endTime: '11:00', location: at(LONDON.borough) })
    await applyProposal((await proposeDay(trip.id, D, SETTINGS))!)
    expect(mins((await db.items.get(lunch.id))!.startTime)).toBeGreaterThanOrEqual(12 * 60)
    expect(mins((await db.items.get(lunch.id))!.startTime)).toBeLessThan(15 * 60)
    expect(mins((await db.items.get(dinner.id))!.startTime)).toBeGreaterThanOrEqual(19 * 60)
  })

  it('says there is nothing to do when everything is fixed', async () => {
    const trip = await makeTrip()
    await addItem(trip, { date: D, title: 'Show', status: 'booked', startTime: '19:00', endTime: '21:00' })
    expect(await proposeDay(trip.id, D, SETTINGS)).toBeUndefined()
  })
})

describe('Plan my days', () => {
  it("times the day's untimed itinerary items and ties wishlist places to them instead of adding them again", async () => {
    const trip = await makeTrip()
    const tower = await addItem(trip, { date: D, title: 'Tower of London', status: 'idea', location: at(LONDON.tower) })
    const gallery = await addItem(trip, { date: D, title: 'National Gallery', status: 'idea', location: at(LONDON.gallery) })
    const towerFav = await addFav(trip, { ...at(LONDON.tower), category: 'castle', visitMin: 120 })
    await linkWishlistToPlan(trip.id, 'London')
    expect(await db.favorites.get(towerFav.id)).toMatchObject({ itemId: tower.id, date: D })
    await applyCityPlan(trip, 'London', [D], SETTINGS)
    const after = await dayItems(trip, D)
    expect(after.filter((i) => i.title === 'Tower of London')).toHaveLength(1)
    expect((await db.items.get(tower.id))!.startTime).toBeDefined()
    expect((await db.items.get(gallery.id))!.startTime).toBeDefined()
    expect(mins((await db.items.get(tower.id))!.endTime) - mins((await db.items.get(tower.id))!.startTime)).toBe(120) // the wishlist's visit time
    noOverlaps(after)
  })

  it('adds wishlist places as timed items with how to get there, and gives the same result when run again', async () => {
    const trip = await makeTrip()
    await addItem(trip, { kind: 'stay', title: 'Hotel', status: 'booked', date: '2027-03-10', nights: 3, location: at(LONDON.hotel) })
    await addFav(trip, { ...at(LONDON.tower), category: 'castle', visitMin: 90, date: D, pinned: true })
    await addFav(trip, { ...at(LONDON.stPauls), category: 'religious', visitMin: 60, date: D, pinned: true })
    await applyCityPlan(trip, 'London', [D], SETTINGS)
    const first = (await dayItems(trip, D)).filter((i) => i.planner)
    expect(first).toHaveLength(2)
    expect(first.every((i) => i.startTime && i.legIn)).toBe(true)
    expect(first[0].legIn!.fromName).toBe('Hotel') // leaves from the hotel
    await applyCityPlan(trip, 'London', [D], SETTINGS)
    const second = (await dayItems(trip, D)).filter((i) => i.planner)
    expect(second.map((i) => [i.title, i.startTime, i.endTime])).toEqual(first.map((i) => [i.title, i.startTime, i.endTime]))
  })

  it('starts the day after a morning arrival and from where it lands', async () => {
    const trip = await makeTrip()
    await addItem(trip, { date: D, kind: 'flight', title: 'Flight in', status: 'booked', startTime: '07:00', endTime: '08:15', from: { name: 'Lisbon' }, to: at(LONDON.heathrow) })
    await addFav(trip, { ...at(LONDON.gallery), category: 'museum', visitMin: 90, date: D, pinned: true })
    await applyCityPlan(trip, 'London', [D], SETTINGS)
    const g = (await dayItems(trip, D)).find((i) => i.planner)!
    expect(mins(g.startTime)).toBeGreaterThanOrEqual(9 * 60 + 15)
    expect(g.legIn!.fromName).toBe('Flight in')
  })

  it('on the day you leave, stops before the flight home', async () => {
    const trip = await makeTrip()
    await addItem(trip, { date: D, kind: 'flight', title: 'Flight home', status: 'booked', startTime: '14:30', endTime: '17:45', from: at(LONDON.heathrow), to: { name: 'Home' } })
    for (const p of [LONDON.tower, LONDON.stPauls, LONDON.nhm, LONDON.kensington]) await addFav(trip, { ...at(p), category: 'museum', visitMin: 90, date: D, pinned: true })
    await applyCityPlan(trip, 'London', [D], SETTINGS)
    const planned = (await dayItems(trip, D)).filter((i) => i.planner)
    for (const i of planned.filter((i) => i.startTime)) expect(mins(i.endTime)).toBeLessThanOrEqual(12 * 60 + 30) // 2 h before the flight
    expect(planned.some((i) => !i.startTime && i.status === 'idea')).toBe(true) // what doesn't fit stays on the day without a time
  })
})

describe('the rest of the day after ticking off or skipping', () => {
  it('closes only the gap that opened, moves your own items too, keeps journeys and bookings', async () => {
    const trip = await makeTrip()
    const a = await addItem(trip, { date: D, title: "St Paul's Cathedral", startTime: '10:00', endTime: '11:30', location: at(LONDON.stPauls) })
    const b = await addItem(trip, { date: D, title: 'Tower of London', startTime: '15:00', endTime: '16:30', location: at(LONDON.tower) })
    const booked = await addItem(trip, { date: D, title: 'Show', status: 'booked', startTime: '19:30', endTime: '21:30' })
    await db.items.update(a.id, { status: 'skipped' })
    const r = (await retimeAfter({ ...a, status: 'skipped' }, SETTINGS))!
    expect(r.moved).toBe(1)
    // 1 h 30 freed: the Tower moves up by at most that (not all the way to the morning).
    expect(mins((await db.items.get(b.id))!.startTime)).toBeGreaterThanOrEqual(15 * 60 - 90)
    expect(mins((await db.items.get(b.id))!.startTime)).toBeLessThan(15 * 60)
    expect(await db.items.get(booked.id)).toMatchObject({ startTime: '19:30' })
    await r.undo()
    expect(await db.items.get(b.id)).toMatchObject({ startTime: '15:00', endTime: '16:30' })
  })

  it('pushes things back when you finish late', async () => {
    const trip = await makeTrip()
    const a = await addItem(trip, { date: D, title: 'National Gallery', startTime: '10:00', endTime: '11:00', location: at(LONDON.gallery) })
    const b = await addItem(trip, { date: D, title: "St Paul's Cathedral", startTime: '11:30', endTime: '12:30', location: at(LONDON.stPauls) })
    const r = (await retimeAfter({ ...a, status: 'done' }, SETTINGS, 12 * 60))! // ticked off at noon, an hour late
    expect(r.shiftMin).toBeGreaterThan(0)
    expect(mins((await db.items.get(b.id))!.startTime)).toBeGreaterThanOrEqual(12 * 60 + 30)
  })
})
