// A demo trip that is always "in progress" (it started yesterday) so the Today view has something to show.

import { db, getSettings } from '../db'
import type { Day, Expense, Favorite, Item, ItemKind, Place, Trip, WalkStop } from '../types'
import { addDays, today } from './dates'
import { draftsToItems, generateChecklist } from './checklist'
import { uid } from './ids'

const LISBON = { name: 'Lisbon', lat: 38.7223, lon: -9.1393 }
const SINTRA = { name: 'Sintra', lat: 38.7979, lon: -9.3906 }
const PORTO = { name: 'Porto', lat: 41.1496, lon: -8.611 }

export async function createDemoTrip(): Promise<string> {
  const settings = await getSettings()
  const id = uid()
  const start = addDays(today(), -1)
  const d = (n: number) => addDays(start, n)
  const eur = (amount: number) => ({ amount, currency: 'EUR' })

  const trip: Trip = {
    id,
    name: 'Portugal with the kids (demo)',
    countryCodes: ['PT'],
    cities: ['Lisbon', 'Sintra', 'Porto'],
    startDate: start,
    endDate: d(6),
    travellers: [
      { id: uid(), name: 'Me', type: 'adult' },
      { id: uid(), name: 'Partner', type: 'adult' },
      { id: uid(), name: 'Kid 1', type: 'child', age: 8 },
      { id: uid(), name: 'Kid 2', type: 'child', age: 5 },
    ],
    style: 'balanced',
    budgetLevel: 'mid',
    interests: ['history', 'food', 'viewpoints', 'aquariums'],
    budget: { flights: 900, transport: 250, stays: 1400, food: 900, activities: 400, other: 150 },
    coverEmoji: '🇵🇹',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    notes: 'Sample trip: everything here is made up for demonstration — flight numbers, hotels and booking references are not real.',
  }

  const days: Day[] = [
    { ...LISBON, title: 'Arrival & Baixa' },
    { ...LISBON, title: 'Castle, Alfama & Oceanário' },
    { ...LISBON, title: 'Belém' },
    { ...SINTRA, title: 'Day trip to Sintra' },
    { ...PORTO, title: 'Train to Porto & Ribeira' },
    { ...PORTO, title: 'Porto highlights' },
    { ...PORTO, title: 'Fly home' },
  ].map((x, i) => ({ id: `${id}:${d(i)}`, tripId: id, date: d(i), city: x.name, lat: x.lat, lon: x.lon, title: x.title }))

  let order = 0
  const it = (date: string, kind: ItemKind, title: string, extra: Partial<Item> = {}): Item => ({
    id: uid(),
    tripId: id,
    date,
    kind,
    title,
    status: 'planned',
    order: order++,
    ...extra,
  })
  const at = (name: string, lat: number, lon: number): Place => ({ name, lat, lon })

  const belemStops: WalkStop[] = [
    { id: 'demo/1', name: 'Jerónimos Monastery', lat: 38.6979, lon: -9.2068, category: 'religious', visitMin: 60, wikipedia: 'en:Jerónimos Monastery' },
    { id: 'demo/2', name: 'Pastéis de Belém', lat: 38.6975, lon: -9.2033, category: 'attraction', visitMin: 30 },
    { id: 'demo/3', name: 'Padrão dos Descobrimentos', lat: 38.6936, lon: -9.2057, category: 'monument', visitMin: 15, wikipedia: 'en:Padrão dos Descobrimentos' },
    { id: 'demo/4', name: 'Belém Tower', lat: 38.6916, lon: -9.216, category: 'castle', visitMin: 45, wikipedia: 'en:Belém Tower' },
  ]
  const belemStart = at('Belém tram stop', 38.6971, -9.2009)
  const line: [number, number][] = [belemStart, ...belemStops].map((p) => [p.lon!, p.lat!])

  const items: Item[] = [
    it(d(0), 'flight', 'Flight to Lisbon (XX 123)', { startTime: '09:10', endTime: '11:05', from: { name: 'Home airport' }, to: at('Lisbon Airport (LIS)', 38.7742, -9.1342), status: 'done', bookingRef: 'DEMO42', cost: eur(880) }),
    it(d(0), 'taxi', 'Taxi to the hotel', { startTime: '11:45', from: { name: 'LIS' }, to: { name: 'Hotel (Baixa)' }, status: 'done', cost: eur(22) }),
    it(d(0), 'stay', 'Family room in Baixa (sample hotel)', { startTime: '14:00', nights: 4, location: at('Baixa, Lisbon', 38.7107, -9.1366), status: 'booked', bookingRef: 'HTL-0001', cost: eur(760) }),
    it(d(0), 'activity', 'Stroll Praça do Comércio & Rua Augusta', { startTime: '16:00', location: at('Praça do Comércio', 38.7075, -9.1364), status: 'done' }),
    it(d(0), 'meal', 'Dinner in Chiado', { startTime: '19:00', status: 'done' }),

    it(d(1), 'meal', 'Breakfast at the hotel', { startTime: '08:00' }),
    it(d(1), 'activity', 'Castelo de São Jorge', { startTime: '09:30', endTime: '11:30', location: at('Castelo de São Jorge', 38.7139, -9.1335), status: 'booked', cost: eur(45), notes: 'Kids under 12 free. Peacocks in the gardens!' }),
    it(d(1), 'walk', 'Walk down through Alfama', { startTime: '11:30', location: at('Alfama', 38.7118, -9.1301), notes: 'Miradouro de Santa Luzia on the way.' }),
    it(d(1), 'meal', 'Lunch: grilled sardines in Alfama', { startTime: '12:30', cost: eur(60) }),
    it(d(1), 'activity', 'Oceanário de Lisboa', { startTime: '15:00', endTime: '17:30', location: at('Oceanário de Lisboa', 38.7635, -9.0937), cost: eur(75), notes: 'Metro red line to Oriente.' }),
    it(d(1), 'meal', 'Dinner near Parque das Nações', { startTime: '19:00' }),

    it(d(2), 'bus', 'Tram 15E to Belém', { startTime: '09:30', from: { name: 'Praça da Figueira' }, to: { name: 'Belém' }, cost: eur(12) }),
    it(d(2), 'walk', 'Belém walk', {
      startTime: '10:00',
      walk: {
        start: belemStart,
        roundTrip: false,
        stops: belemStops,
        geometry: line,
        legs: [],
        distanceM: 2100,
        walkS: 1700,
        routedBy: 'straight-line',
      },
    }),
    it(d(2), 'activity', 'MAAT riverside & playground', { startTime: '15:00', location: at('MAAT', 38.6957, -9.1956), status: 'idea' }),

    it(d(3), 'train', 'Train Rossio → Sintra', { startTime: '09:11', endTime: '09:51', from: at('Rossio station', 38.7142, -9.1409), to: at('Sintra station', 38.7999, -9.3797), cost: eur(19) }),
    it(d(3), 'activity', 'Pena Palace (timed ticket)', { startTime: '10:30', location: at('Pena Palace', 38.7876, -9.3906), cost: eur(60), notes: 'Take bus 434 up the hill.' }),
    it(d(3), 'activity', 'Quinta da Regaleira — initiation well', { startTime: '14:00', location: at('Quinta da Regaleira', 38.7963, -9.3959), cost: eur(40) }),
    it(d(3), 'train', 'Train Sintra → Rossio', { startTime: '17:20', endTime: '18:00', from: { name: 'Sintra' }, to: { name: 'Rossio' }, cost: eur(19) }),

    it(d(4), 'train', 'Alfa Pendular Lisbon → Porto', { startTime: '10:09', endTime: '13:03', from: at('Lisboa Santa Apolónia', 38.7137, -9.1225), to: at('Porto Campanhã', 41.1488, -8.5855), status: 'booked', bookingRef: 'CP-DEMO7', cost: eur(98) }),
    it(d(4), 'stay', 'Apartment in Ribeira (to book)', { nights: 2, location: at('Ribeira, Porto', 41.1408, -8.6131), status: 'idea', cost: eur(320) }),
    it(d(4), 'activity', 'Ribeira riverside & Dom Luís I bridge at sunset', { startTime: '18:00', location: at('Dom Luís I Bridge', 41.1399, -8.6094) }),

    it(d(5), 'activity', 'Livraria Lello', { startTime: '09:30', location: at('Livraria Lello', 41.1469, -8.6149), status: 'booked', cost: eur(40) }),
    it(d(5), 'activity', 'Clérigos Tower', { startTime: '10:30', location: at('Clérigos Tower', 41.1458, -8.614), cost: eur(30) }),
    it(d(5), 'activity', 'Port cellar visit in Gaia (juice for kids!)', { startTime: '15:00', location: at('Vila Nova de Gaia', 41.1373, -8.6125), cost: eur(50) }),

    it(d(6), 'taxi', 'Metro to the airport', { startTime: '11:30', from: { name: 'Trindade' }, to: { name: 'OPO' }, cost: eur(10) }),
    it(d(6), 'flight', 'Flight home (XX 456)', { startTime: '14:30', endTime: '17:45', from: at('Porto Airport (OPO)', 41.2481, -8.6814), to: { name: 'Home airport' }, status: 'booked', bookingRef: 'DEMO42' }),
  ]

  const expenses: Expense[] = [
    { id: uid(), tripId: id, date: d(0), amount: 22, currency: 'EUR', amountHome: 22, category: 'transport', note: 'Taxi from airport', createdAt: Date.now() },
    { id: uid(), tripId: id, date: d(0), amount: 18.5, currency: 'EUR', amountHome: 18.5, category: 'food', note: 'Pastries & coffee', createdAt: Date.now() },
    { id: uid(), tripId: id, date: d(0), amount: 74, currency: 'EUR', amountHome: 74, category: 'food', note: 'Dinner in Chiado', createdAt: Date.now() },
  ]

  // Not on any day yet: they show up as backup ideas on Today, or can be spread with "Plan my days".
  const fav = (city: string, name: string, category: string, visitMin: number, lat?: number, lon?: number, indoor?: boolean): Favorite => ({
    id: uid(), tripId: id, city, name, category, visitMin, lat, lon, indoor, source: 'manual', addedAt: Date.now(),
  })
  const favorites: Favorite[] = [
    fav('Lisbon', 'National Tile Museum', 'museum', 90, 38.7247, -9.1137),
    fav('Lisbon', 'Igreja de São Roque', 'religious', 30, 38.7136, -9.1435),
    fav('Lisbon', 'Miradouro da Senhora do Monte', 'viewpoint', 20, 38.7193, -9.1327),
    fav('Lisbon', 'LX Factory', 'shopping', 90, 38.7034, -9.1784, true),
    fav('Lisbon', 'Fado evening (family-friendly early show)', 'experience', 120, undefined, undefined, true),
    fav('Porto', 'Palácio da Bolsa', 'castle', 60, 41.1412, -8.6155, true),
    fav('Porto', 'Crystal Palace Gardens', 'park', 60, 41.1481, -8.6258),
    fav('Porto', 'Serralves Museum & Park', 'museum', 150, 41.1597, -8.6598),
  ]

  const checklist = draftsToItems(id, generateChecklist(trip, items, settings), []).map((c) =>
    // Most things are done by the time the trip has started.
    ({ ...c, done: !c.ruleId?.startsWith('stay-gap') && !c.ruleId?.startsWith('checkin') && !c.ruleId?.startsWith('ticket') }),
  )

  await db.transaction('rw', [db.trips, db.days, db.items, db.expenses, db.checklist, db.favorites], async () => {
    await db.favorites.bulkAdd(favorites)
    await db.trips.add(trip)
    await db.days.bulkAdd(days)
    await db.items.bulkAdd(items)
    await db.expenses.bulkAdd(expenses)
    await db.checklist.bulkAdd(checklist)
  })
  return id
}
