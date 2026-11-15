import { describe, expect, it } from 'vitest'
import { parseBookings, parseCityIdeas, parseDetail, parsePlan } from './ai'

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
