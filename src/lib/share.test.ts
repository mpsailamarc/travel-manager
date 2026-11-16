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
  it('more travellers: people and rooms are counted out on each line, and the amounts follow; typed amounts stay', async () => {
    const { adjustLinesToTrip, estimateBudgetLines } = await import('./budget')
    const adult = (id: string) => ({ id, name: id, type: 'adult' as const })
    const two = await makeTrip({ travellers: [adult('a'), adult('b')], countryCodes: ['GR'] })
    const { lines } = await estimateBudgetLines(two, 'FR', 'EUR')
    const typed = { id: 'own', category: 'other' as const, label: 'Souvenirs', amount: 100 }
    const four = { ...two, travellers: [adult('a'), adult('b'), adult('c'), adult('d')] }
    const after = adjustLinesToTrip([...lines, typed], two, four)
    const find = (ls: typeof lines, re: RegExp) => ls.find((l) => re.test(l.label))!
    expect(find(after, /^Flights/)).toMatchObject({ per: 'person', count: 4 })
    expect(find(after, /^Food/)).toMatchObject({ per: 'person', count: 4 })
    expect(find(after, /^Food/).amount).toBeCloseTo(find(lines, /^Food/).amount * 2, -1)
    expect(find(after, /^Accommodation/)).toMatchObject({ per: 'room', count: 2 })
    expect(find(after, /^Accommodation/).amount).toBe(find(lines, /^Accommodation/).amount * 2)
    expect(after.find((l) => l.id === 'own')).toEqual(typed)
  })

  it('a longer trip: more nights and more days of food', async () => {
    const { adjustLinesToTrip, estimateBudgetLines } = await import('./budget')
    const trip = await makeTrip({ travellers: [{ id: 'a', name: 'a', type: 'adult' }], countryCodes: ['GR'] })
    const { lines } = await estimateBudgetLines(trip, 'FR', 'EUR')
    const longer = { ...trip, endDate: '2027-03-15' } // 3 days → 6 days
    const after = adjustLinesToTrip(lines, trip, longer)
    expect(after.find((l) => /^Accommodation/.test(l.label))!.qty).toBe(5)
    expect(after.find((l) => /^Food/.test(l.label))!).toMatchObject({ qty: 6, unit: 'days', per: 'person', count: 1 })
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

describe('prices and notes follow the group', () => {
  const adult = (id: string) => ({ id, name: id, type: 'adult' as const })
  it('estimated plan prices scale with the travellers; booked ones and taxis stay', async () => {
    const { scaleCostsForGroup } = await import('./budget')
    const two = await makeTrip({ travellers: [adult('a'), adult('b')] })
    const four = { ...two, travellers: [adult('a'), adult('b'), adult('c'), adult('d')] }
    const items = [
      { id: 'f', kind: 'flight', status: 'planned', cost: { amount: 400, currency: 'EUR' } },
      { id: 'b', kind: 'flight', status: 'booked', bookingRef: 'X', cost: { amount: 400, currency: 'EUR' } },
      { id: 't', kind: 'taxi', status: 'planned', cost: { amount: 30, currency: 'EUR' } },
      { id: 'h', kind: 'stay', status: 'planned', cost: { amount: 300, currency: 'EUR' } },
    ] as never[]
    const out = new Map(scaleCostsForGroup(items, two, four).map((p) => [p.id, p.cost.amount]))
    expect(out.get('f')).toBe(800)
    expect(out.has('b')).toBe(false)
    expect(out.has('t')).toBe(false)
    expect(out.get('h')).toBe(600) // two rooms instead of one
  })

  it('"How this was estimated" and figures from an itinerary idea follow too', async () => {
    const { adjustBasisToTrip, adjustPlanBudgetToTrip } = await import('./budget')
    const two = await makeTrip({ travellers: [adult('a'), adult('b')] })
    const four = { ...two, travellers: [adult('a'), adult('b'), adult('c'), adult('d')] }
    expect(adjustBasisToTrip(['For 2 adults, 3 days and 2 nights (1 room).', 'Other note.'], four)).toEqual(['For 4 adults, 3 days and 2 nights (2 rooms).', 'Other note.'])
    expect(adjustPlanBudgetToTrip({ flights: 800, food: 300, other: 50 }, ['flights', 'food'], undefined, two, four)).toEqual({ flights: 1600, food: 600, other: 50 })
  })
})

describe('every budget line reads as a sum that adds up', () => {
  const adult = (id: string) => ({ id, name: id, type: 'adult' as const })
  const child = (id: string) => ({ id, name: id, type: 'child' as const, age: 8 })

  it('each estimate line is quantity × people or rooms × price, and says so', async () => {
    const { estimateBudgetLines, lineAmount, lineFormula } = await import('./budget')
    const trip = await makeTrip({ travellers: [adult('a'), adult('b'), child('c')], countryCodes: ['GR'], cities: ['Athens', 'Naxos'] })
    const { lines } = await estimateBudgetLines(trip, 'FR', 'EUR')
    for (const l of lines) {
      expect(l.amount).toBe(Math.round(l.qty! * l.price! * (l.per ? l.count! : 1)))
      expect(l.amount).toBe(lineAmount(l))
    }
    const fmt = (n: number) => `€${n}`
    const f = (re: RegExp) => lineFormula(lines.find((l) => re.test(l.label))!, fmt)
    expect(f(/^Flights/)).toMatch(/^1 return flight × 3 people × €[\d.]+ per person$/)
    expect(f(/^Food/)).toMatch(/^3 days × 3 people × €[\d.]+ per person per day$/)
    expect(f(/^Accommodation/)).toMatch(/^2 nights × 1 room × €[\d.]+ per room per night$/)
    expect(f(/^Moving/)).toMatch(/^1 move × 3 people × €[\d.]+ per person per move$/)
  })

  it('older "person-days" lines become days × people × price per person, keeping their amount', async () => {
    const { modernLine } = await import('./budget')
    const trip = await makeTrip({ travellers: [adult('a'), adult('b'), child('c')] }) // 3 days
    const old = { id: 'x', category: 'food' as const, label: 'Food & drink (2 adults + 1 child)', qty: 7.8, unit: 'person-days', price: 45, amount: 351 }
    const l = modernLine(old, trip)
    expect(l).toMatchObject({ label: 'Food & drink', qty: 3, unit: 'days', per: 'person', count: 3 })
    expect(Math.abs(l.qty! * l.count! * l.price! - 351)).toBeLessThan(1)
    const flights = modernLine({ id: 'f', category: 'flights', label: 'Flights, return (2 adults + 1 child)', qty: 3, unit: 'travellers', price: 170, amount: 510 }, trip)
    expect(flights).toMatchObject({ label: 'Flights, return', qty: 1, unit: 'return flight', per: 'person', count: 3, price: 170, amount: 510 })
  })
})

describe('fuel when there is a car', () => {
  it('counts the road between the places you stay while you have the car, plus local driving', async () => {
    const { fuelEstimate } = await import('./budget')
    const day = (date: string, city: string, lat: number, lon: number) => ({ id: date, tripId: 't', date, city, lat, lon })
    const days = [day('2027-07-15', 'Athens', 37.9755, 23.7348), day('2027-07-16', 'Nafplio', 37.562, 22.808), day('2027-07-17', 'Nafplio', 37.562, 22.808), day('2027-07-18', 'Athens', 37.9755, 23.7348)]
    const car = [
      { id: 'f', kind: 'flight', title: 'Flight to Athens', date: '2027-07-15', status: 'booked', to: { name: 'Athens (ATH)', lat: 37.9364, lon: 23.9445 } },
      { id: 'p', kind: 'car', title: 'Pick up the car', date: '2027-07-16', status: 'planned' },
      { id: 'd', kind: 'drive', title: 'Drive back to Athens', date: '2027-07-18', status: 'planned' },
    ] as never[]
    const f = fuelEstimate(car, days)!
    expect(f.route).toEqual(['Athens → Nafplio → Athens']) // picked up where you slept the night before
    // 2 × ~92 km straight × 1.3 + 3 days × 30 km of local driving
    expect(f.km).toBeGreaterThan(300)
    expect(f.km).toBeLessThan(350)
    expect(fuelEstimate([], days)).toBeUndefined() // no car, no fuel
  })

  it("doesn't count the flight before you pick up the car", async () => {
    const { fuelEstimate } = await import('./budget')
    const day = (date: string, city: string, lat: number, lon: number) => ({ id: date, tripId: 't', date, city, lat, lon })
    const days = [day('2027-01-01', 'Sydney', -33.8688, 151.2093), day('2027-01-02', 'Santiago', -33.4489, -70.6693), day('2027-01-03', 'Valparaíso', -33.0472, -71.6127)]
    const flight = { id: 'f', kind: 'flight', title: 'Sydney → Santiago', date: '2027-01-01', status: 'booked', to: { name: 'Santiago (SCL)', lat: -33.393, lon: -70.7858 } }
    const car = [
      { id: 'p', kind: 'car', title: 'Pick up the car', date: '2027-01-02', status: 'planned' },
      { id: 'd', kind: 'drive', title: 'Drive to Valparaíso', date: '2027-01-03', status: 'planned' },
    ]
    for (const items of [[flight, ...car], car]) {
      // With the flight in the plan, or without it (too far to be a drive either way): Santiago → Valparaíso only.
      const f = fuelEstimate(items as never[], days)!
      expect(f.route).toEqual(['Santiago → Valparaíso'])
      expect(f.km).toBeLessThan(250)
    }
  })

  it('counts the drives on a day you flew in, by their time when their places are unknown', async () => {
    const { fuelEstimate } = await import('./budget')
    const day = (date: string, city: string, lat: number, lon: number) => ({ id: date, tripId: 't', date, city, lat, lon })
    const days = [day('2027-01-01', 'Santiago', -33.4489, -70.6693), day('2027-01-02', 'San Pedro de Atacama', -22.9083, -68.1994)]
    const items = [
      { id: 'f', kind: 'flight', title: 'Santiago → Calama', date: '2027-01-02', status: 'booked', to: { name: 'Calama (CJC)' } },
      { id: 'd', kind: 'drive', title: 'Drive to San Pedro', date: '2027-01-02', status: 'planned', startTime: '09:00', endTime: '10:30', from: { name: 'Calama (CJC)' }, to: { name: 'San Pedro de Atacama' } },
    ]
    const f = fuelEstimate(items as never[], days)!
    expect(f.route).toEqual(['Calama (CJC) → San Pedro de Atacama'])
    expect(f.km).toBe(Math.round(1.5 * 70 + 30)) // 1 h 30 at about 70 km/h, plus a day of local driving
  })
})

describe('the budget of a camper van trip', () => {
  it('has the van and campsites instead of a car rental and hotels', async () => {
    const { estimateBudgetLines } = await import('./budget')
    const { makeTrip } = await import('../test/fixtures')
    const trip = await makeTrip({ sleep: 'camper', countryCodes: ['FR'], travellers: [{ id: 'a', name: 'a', type: 'adult' }, { id: 'b', name: 'b', type: 'adult' }] })
    const { lines } = await estimateBudgetLines(trip, 'FR', 'EUR', [])
    const labels = lines.map((l) => l.label)
    expect(labels).toContain('Camper van rental')
    expect(labels).toContain('Campsites')
    expect(labels).not.toContain('Accommodation')
    expect(labels.some((l) => /^Fuel/.test(l))).toBe(true)
  })
})
