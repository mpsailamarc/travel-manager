import { describe, expect, it } from 'vitest'
import { movesLine, outlinePrompt, outlineRounds, parseBookings, parseCityIdeas, parseDetail, parsePlan, routeShape } from './ai'
import type { Settings, Trip } from '../types'

const option = (title: string) => ({ title, summary: 's', route: ['Lisbon'], days: [{ day: 1, city: 'Lisbon', title: 'Alfama', highlights: ['Castle'] }], budget: { stays: 500 }, tips: [] })

describe('reading chatbot answers', () => {
  it('finds the JSON inside a chatty answer with a code fence', () => {
    const text = 'Sure! Here is option 1:\n```json\n' + JSON.stringify({ option: option('Coast & castles') }) + '\n```\nEnjoy!'
    expect(parsePlan(text).options.map((o) => o.title)).toEqual(['Coast & castles'])
  })

  it('accepts the older "options" shape and a bare option', () => {
    expect(parsePlan(JSON.stringify({ options: [option('A'), option('B')] })).options).toHaveLength(2)
    expect(parsePlan(JSON.stringify(option('Bare'))).options[0].title).toBe('Bare')
  })

  it('keeps the complete days of an answer that was cut off, and says so', () => {
    const full = JSON.stringify({
      days: [
        { day: 1, city: 'Lisbon', items: [{ kind: 'activity', title: 'Castle', time: '10:00' }] },
        { day: 2, city: 'Sintra', items: [{ kind: 'activity', title: 'Pena Palace', time: '10:00' }] },
      ],
      checklist: [],
    })
    const cut = full.slice(0, full.indexOf('Pena') + 4) // stops in the middle of day 2
    const r = parseDetail(cut)
    expect(r.truncated).toBe(true)
    expect(r.days.map((d) => d.day)).toEqual([1]) // the half-written last day is dropped, to be asked for again
  })

  it('drops broken entries instead of failing the whole answer', () => {
    const ideas = parseCityIdeas(JSON.stringify({ ideas: [{ name: 'Time Out Market', category: 'food', lat: 38.7, lon: -9.1 }, { category: 'no name' }, 'junk'] }))
    expect(ideas.map((i) => i.name)).toEqual(['Time Out Market'])
  })

  it('reads bookings with their dates, times and references', () => {
    const b = parseBookings(JSON.stringify({ items: [{ kind: 'flight', title: 'TAP TP1350', date: '2027-03-10', time: '07:00', from: 'LIS', to: 'LHR', bookingRef: 'ABC123' }] }))
    expect(b[0]).toMatchObject({ kind: 'flight', date: '2027-03-10', time: '07:00', bookingRef: 'ABC123' })
  })

  it('explains what went wrong when there is no JSON at all', () => {
    expect(() => parsePlan('Sorry, I cannot help with that.')).toThrow()
  })
})

describe('importing bookings into the plan', () => {
  it('a confirmation turns the planned flight into a booked one with its reference, and importing it twice changes nothing', async () => {
    const { applyBookings } = await import('./ai')
    const { db } = await import('../db')
    const { addItem, makeTrip } = await import('../test/fixtures')
    const trip = await makeTrip()
    await addItem(trip, { date: '2027-03-10', kind: 'flight', title: 'Flight to London', status: 'planned', startTime: '07:00' })
    const booking = parseBookings(JSON.stringify({ items: [{ kind: 'flight', title: 'TAP TP1350 Lisbon–London', date: '2027-03-10', time: '07:05', bookingRef: 'ABC123', estCost: 180 }] }))
    await applyBookings(trip, booking, 'EUR')
    await applyBookings(trip, booking, 'EUR')
    const flights = await db.items.where({ tripId: trip.id, date: '2027-03-10' }).toArray()
    expect(flights).toHaveLength(1)
    expect(flights[0]).toMatchObject({ status: 'booked', bookingRef: 'ABC123', startTime: '07:05' })
  })
})

describe('the itinerary prompt knows how you want to travel', () => {
  const people = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `p${i}`, type: 'adult' as const }))
  const trip = (over: Partial<Trip> = {}): Trip => ({
    id: 't', name: 'T', countryCodes: ['GR'], cities: [], startDate: '2027-07-01', endDate: '2027-07-10',
    travellers: people(1), style: 'balanced', budgetLevel: 'mid', interests: [], budget: {}, createdAt: 0, updatedAt: 0, ...over,
  } as Trip)
  const settings = { homeCurrency: 'EUR' } as Settings

  it('leans towards driving for a group, unless you chose', () => {
    expect(movesLine(trip())).toMatch(/only when it saves a lot of time/)
    expect(movesLine(trip({ travellers: people(3) }))).toMatch(/every flight is paid 3 times.*prefer driving/)
    expect(movesLine(trip({ travellers: people(3), innerFlights: 'fly' }))).toMatch(/flying between places is fine/)
    expect(movesLine(trip({ innerFlights: 'none' }))).toMatch(/no flights inside the trip/)
  })

  it('puts the focus and the way of travelling into the outline prompt', () => {
    const p = outlinePrompt(trip({ travellers: people(2), focus: 'outdoors' }), settings)
    expect(p).toContain('Focus: a road trip')
    expect(p).toContain('Getting between places: we are 2')
    expect(outlinePrompt(trip(), settings)).toContain('Focus: a balance of cities')
  })
})

describe('all three itinerary options in one go', () => {
  const opt = (title: string, days: number) => ({ title, bestFor: 'x', summary: 's', route: ['A'], days: Array.from({ length: days }, (_, i) => ({ day: i + 1, city: i < 2 ? 'A' : 'B', title: 't', highlights: [] })), budget: {}, tips: [] })
  it('asks for the three options and how they differ in one prompt', () => {
    const t = { id: 't', name: 'T', countryCodes: ['GR'], cities: [], startDate: '2027-07-01', endDate: '2027-07-04', travellers: [], style: 'intense', budgetLevel: 'mid', interests: [], budget: {} } as unknown as Trip
    const p = outlinePrompt(t, { homeCurrency: 'EUR' } as Settings)
    expect(p).toContain('all 3 in this reply')
    expect(p).toContain('"compare"')
    expect(p).toContain('Pace: all out')
  })

  it('reads the comparison and the options; after a cut-off reply only the missing ones are asked for', () => {
    const whole = JSON.stringify({ compare: 'A is calm, B is fast, C is cheap.', options: [opt('A', 4), opt('B', 4), opt('C', 4)] })
    const one = outlineRounds([whole], 'prompt', 4)
    expect(one.compare).toMatch(/A is calm/)
    expect(one.options.map((o) => o.option.title)).toEqual(['A', 'B', 'C'])
    expect(one.done).toBe(true)
    expect(one.rounds).toHaveLength(1)

    const cut = whole.slice(0, whole.indexOf('"day":3', whole.indexOf('"title":"C"'))) // stops in option C's day 3
    const two = outlineRounds([cut], 'prompt', 4)
    expect(two.options.map((o) => [o.option.title, o.incomplete])).toEqual([['A', false], ['B', false], ['C', true]])
    expect(two.rounds[1].prompt).toMatch(/cut off after option 2.*option 3/)
    expect(routeShape(two.options[0].option)).toEqual({ places: 2, moves: 1 })
  })
})

describe('the detailed plan asks for times the app can trust', () => {
  it('local times, journeys that end on arrival, real sunsets, the night’s town, untimed notes', async () => {
    const { detailPrompt } = await import('./ai')
    const t = { id: 't', name: 'T', countryCodes: ['CL'], cities: [], startDate: '2027-02-01', endDate: '2027-02-03', travellers: [], style: 'intense', budgetLevel: 'mid', interests: [], budget: {} } as unknown as Trip
    const o = { title: 'A', bestFor: '', summary: '', route: ['Santiago'], days: [{ day: 1, city: 'Santiago', title: 't', highlights: [], items: [] }], budget: {}, checklist: [], tips: [] }
    const p = detailPrompt(t, { homeCurrency: 'EUR' } as Settings, o as never, [1], false)
    expect(p).toMatch(/local clock where\s+it leaves/)
    expect(p).toMatch(/endTime" is when you arrive/)
    expect(p).toMatch(/real sunrise or sunset time/)
    expect(p).toMatch(/town where we sleep that night/)
    expect(p).toContain('A "note" has no time.')
    expect(p).toMatch(/Every journey needs both ends/)
    expect(p).toMatch(/getting to the airport or station .* the flight or train, then getting from where it arrives/)
  })

  it('keeps where a journey leaves from, and drops a time a chatbot gave a note', async () => {
    const { applyPlan } = await import('./ai')
    const { makeTrip } = await import('../test/fixtures')
    const { db } = await import('../db')
    const trip = await makeTrip()
    const items = [
      { kind: 'flight', title: 'Flight SYD → SCL', time: '11:30', endTime: '10:00', from: 'Sydney (SYD)', fromLat: -33.94, fromLon: 151.18, to: 'Santiago (SCL)', lat: -33.39, lon: -70.79 },
      { kind: 'note', title: 'Checklist: arrival papers', time: '23:00' },
    ]
    const option = { title: 'A', bestFor: '', summary: '', route: [], days: [{ day: 1, city: 'Santiago', title: 't', highlights: [], items }], budget: {}, checklist: [], tips: [] }
    await applyPlan(trip, option as never, 'EUR', true)
    const saved = await db.items.where('tripId').equals(trip.id).toArray()
    expect(saved.find((i) => i.kind === 'flight')!.from).toMatchObject({ lat: -33.94, lon: 151.18 })
    expect(saved.find((i) => i.kind === 'note')!.startTime).toBeUndefined()
  })
})

describe('city ideas', () => {
  it('reads visit times given in hours as hours', () => {
    const text = JSON.stringify({ ideas: [{ name: 'Eiffel Tower', category: 'monument', visitMin: 2 }, { name: 'Louvre', category: 'museum', visitMin: 180 }, { name: 'Café', category: 'food', visitMin: 1.5 }] })
    expect(parseCityIdeas(text).map((i) => i.visitMin)).toEqual([120, 180, 90])
  })
})

describe('home is only the starting point', () => {
  it('leaves the start out of the trip’s places and drops what an itinerary planned there', async () => {
    const { applyPlan } = await import('./ai')
    const { makeTrip } = await import('../test/fixtures')
    const { db } = await import('../db')
    const trip = await makeTrip({ startPlace: { name: 'Sydney', lat: -33.87, lon: 151.21 }, startDate: '2027-07-01', endDate: '2027-07-03' })
    const option = {
      title: 'A',
      bestFor: '',
      summary: '',
      route: ['Sydney', 'Rome', 'Sydney'],
      days: [
        { day: 1, city: 'Sydney', lat: -33.87, lon: 151.21, title: 'Leave', highlights: [], items: [{ kind: 'meal', title: 'Last brunch in Bondi' }, { kind: 'flight', title: 'Sydney → Rome', from: 'Sydney (SYD)', to: 'Rome (FCO)', time: '21:00', endTime: '07:00' }] },
        { day: 2, city: 'Rome', lat: 41.9, lon: 12.5, title: 'Rome', highlights: [], items: [{ kind: 'activity', title: 'Colosseum', time: '10:00' }] },
      ],
      budget: {},
      checklist: [],
      tips: [],
    }
    await applyPlan(trip, option as never, 'EUR', true)
    expect((await db.trips.get(trip.id))!.cities).toEqual(['Rome'])
    const titles = (await db.items.where('tripId').equals(trip.id).toArray()).map((i) => i.title).sort()
    // The answer forgot the way home: it's added, the day after the last night away.
    expect(titles).toEqual(['Colosseum', 'Flight home: Rome → Sydney', 'Sydney → Rome'])
    const home = (await db.items.where('tripId').equals(trip.id).toArray()).find((i) => i.title.startsWith('Flight home'))!
    expect(home).toMatchObject({ date: '2027-07-03', kind: 'flight', status: 'idea' })
  })

  it('prices a forgotten flight home like the flight out, and adds nothing when the plan has both', async () => {
    const { applyPlan } = await import('./ai')
    const { makeTrip } = await import('../test/fixtures')
    const { db } = await import('../db')
    const sydney = { name: 'Sydney', lat: -33.87, lon: 151.21 }
    const day1 = { day: 1, city: 'Rome', lat: 41.9, lon: 12.5, title: 'Fly', highlights: [], items: [{ kind: 'flight', title: 'Flight SYD → FCO', from: 'Sydney Kingsford Smith (SYD)', to: 'Rome (FCO)', time: '21:00', estCost: 1500 }] }
    const plan = (days: unknown[]) => ({ title: 'A', bestFor: '', summary: '', route: ['Rome'], days, budget: {}, checklist: [], tips: [] })
    const one = await makeTrip({ startPlace: sydney, startDate: '2027-07-01', endDate: '2027-07-06' })
    await applyPlan(one, plan([day1, { day: 6, city: 'Rome', lat: 41.9, lon: 12.5, title: 'Rome', highlights: [], items: [] }]) as never, 'AUD', true)
    const added = (await db.items.where('tripId').equals(one.id).toArray()).filter((i) => i.title.startsWith('Flight home'))
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({ date: '2027-07-06', cost: { amount: 1500, currency: 'AUD' } })

    const both = await makeTrip({ startPlace: sydney, startDate: '2027-07-01', endDate: '2027-07-06' })
    const day6 = { day: 6, city: 'Rome', lat: 41.9, lon: 12.5, title: 'Home', highlights: [], items: [{ kind: 'flight', title: 'Flight FCO → SYD', from: 'Rome (FCO)', to: 'Sydney (SYD)', time: '12:00' }] }
    await applyPlan(both, plan([day1, day6]) as never, 'AUD', true)
    expect((await db.items.where('tripId').equals(both.id).toArray()).filter((i) => i.kind === 'flight')).toHaveLength(2)
  })

  it('drops the taxi to the airport at home, and the budget is at least what the plan’s own prices add up to', async () => {
    const { applyPlan } = await import('./ai')
    const { makeTrip } = await import('../test/fixtures')
    const { db } = await import('../db')
    const trip = await makeTrip({ startPlace: { name: 'Sydney', lat: -33.87, lon: 151.21 }, startDate: '2027-07-01', endDate: '2027-07-03' })
    const day1 = {
      day: 1, city: 'Rome', lat: 41.9, lon: 12.5, title: 'Fly', highlights: [],
      items: [
        { kind: 'taxi', title: 'Drive to Sydney Airport', from: 'Home / central Sydney', to: 'Sydney Kingsford Smith Airport (SYD)', time: '18:30' },
        { kind: 'flight', title: 'Flight SYD → FCO', from: 'Sydney (SYD)', to: 'Rome (FCO)', time: '21:30', estCost: 1500 },
        { kind: 'taxi', title: 'Taxi to the hotel', from: 'Rome (FCO)', to: 'Hotel in Rome', time: '09:00' },
      ],
    }
    const day3 = { day: 3, city: 'Rome', lat: 41.9, lon: 12.5, title: 'Home', highlights: [], items: [{ kind: 'flight', title: 'Flight FCO → SYD', from: 'Rome (FCO)', to: 'Sydney (SYD)', time: '12:00', estCost: 1600 }] }
    await applyPlan(trip, { title: 'A', bestFor: '', summary: '', route: ['Rome'], days: [day1, day3], budget: { flights: 2000, food: 300 }, checklist: [], tips: [] } as never, 'AUD', true)
    const titles = (await db.items.where('tripId').equals(trip.id).toArray()).map((i) => i.title)
    expect(titles).not.toContain('Drive to Sydney Airport')
    expect(titles).toContain('Taxi to the hotel')
    expect((await db.trips.get(trip.id))!.budget).toMatchObject({ flights: 3100, food: 300 })
  })
})

describe('options on a map, and changes to an option', () => {
  const o = { title: 'A', bestFor: '', summary: '', route: ['Rome', 'Florence'], budget: {}, checklist: [], tips: [], days: [
    { day: 1, city: 'Rome', lat: 41.9, lon: 12.5, highlights: [], items: [] },
    { day: 2, city: 'Rome', highlights: [], items: [] },
    { day: 3, city: 'Florence', lat: 43.77, lon: 11.25, highlights: [], items: [] },
  ] }
  it('lists the places in order with the days spent in each', async () => {
    const { optionStops } = await import('./ai')
    expect(optionStops(o as never)).toEqual([
      { name: 'Rome', lat: 41.9, lon: 12.5, nights: 2 },
      { name: 'Florence', lat: 43.77, lon: 11.25, nights: 1 },
    ])
  })
  it('asks for ONE revised option that follows the changes, in the outline shape', async () => {
    const { revisePrompt, parseRevision } = await import('./ai')
    const { makeTrip, SETTINGS } = await import('../test/fixtures')
    const trip = await makeTrip()
    const p = revisePrompt(trip, SETTINGS, o as never, '4 nights in Rome, add Venice')
    expect(p).toContain('4 nights in Rome, add Venice')
    expect(p).toContain('Day 3 (2027-03-12) — Florence')
    expect(p).toContain('"route"')
    expect(parseRevision('```json\n{"options":[{"title":"Rome longer","route":["Rome"],"days":[{"day":1,"city":"Rome","highlights":["x"]}]}]}\n```').title).toBe('Rome longer')
    expect(() => parseRevision('```json\n{"options":[]}\n```')).toThrow()
  })
})

