import { describe, expect, it } from 'vitest'
import { db } from '../db'
import { planChanges, planInputs } from './planbasis'
import { syncBudgetToTrip, estimateBudgetLines } from './budget'
import { addItem, makeTrip } from '../test/fixtures'

describe('the itinerary knows what it was made for', () => {
  it('says what changed since: dates, pace, destination…, but not who is travelling', async () => {
    const trip = await makeTrip({ travellers: [{ id: 'a', name: 'a', type: 'adult' }] })
    const made = { ...trip, planBasis: planInputs(trip) }
    expect(planChanges(made)).toEqual([])
    expect(planChanges({ ...made, endDate: '2027-03-14', style: 'packed' })).toEqual(['dates', 'pace'])
    expect(planChanges({ ...made, countryCodes: ['FR'] })).toEqual(['destination'])
    expect(planChanges({ ...made, travellers: [...trip.travellers, { id: 'b', name: 'b', type: 'adult' }] })).toEqual([])
    expect(planChanges({ ...trip })).toEqual([]) // no itinerary yet: nothing to say
  })
})

describe('the budget follows the trip details', () => {
  it('a higher budget level raises the estimate; flights by less', async () => {
    const adult = { id: 'a', name: 'a', type: 'adult' as const }
    const trip = await makeTrip({ travellers: [adult], countryCodes: ['GR'], budgetLevel: 'mid' })
    const { lines } = await estimateBudgetLines(trip, 'FR', 'EUR')
    await db.trips.update(trip.id, { budgetLines: lines })
    const before = (await db.trips.get(trip.id))!
    const after = { ...before, budgetLevel: 'comfort' as const }
    await db.trips.update(trip.id, { budgetLevel: 'comfort' })
    await syncBudgetToTrip(before, after)
    const now = (await db.trips.get(trip.id))!
    const get = (ls: typeof lines, re: RegExp) => ls.find((l) => re.test(l.label))!.amount
    expect(get(now.budgetLines!, /^Food/) / get(lines, /^Food/)).toBeCloseTo(1.7, 1)
    expect(get(now.budgetLines!, /^Flights/) / get(lines, /^Flights/)).toBeCloseTo(Math.sqrt(1.7), 1)
  })

  it('more people: estimated plan prices follow, booked ones stay', async () => {
    const adult = (id: string) => ({ id, name: id, type: 'adult' as const })
    const trip = await makeTrip({ travellers: [adult('a')] })
    const est = await addItem(trip, { date: trip.startDate, kind: 'flight', title: 'Flight', cost: { amount: 200, currency: 'EUR' } })
    const booked = await addItem(trip, { date: trip.startDate, kind: 'train', title: 'Train', status: 'booked', bookingRef: 'R', cost: { amount: 50, currency: 'EUR' } })
    const r = await syncBudgetToTrip(trip, { ...trip, travellers: [adult('a'), adult('b')] })
    expect(r.prices).toBe(1)
    expect((await db.items.get(est.id))!.cost!.amount).toBe(400)
    expect((await db.items.get(booked.id))!.cost!.amount).toBe(50)
  })
})
