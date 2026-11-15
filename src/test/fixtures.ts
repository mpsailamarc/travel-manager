// Small builders for test trips, so each test says only what matters to it.
import { db } from '../db'
import type { Day, Favorite, Item, Settings, Trip } from '../types'

export const SETTINGS: Settings = { id: 'me', name: '', homeCurrency: 'EUR', nationality: 'FR', walkSpeedKmh: 4.5 }

// London places used across tests (real coordinates, so distances are realistic).
export const LONDON = {
  centre: { lat: 51.5074, lon: -0.1278 },
  hotel: { name: 'Hotel Covent Garden', lat: 51.5117, lon: -0.124 },
  tower: { name: 'Tower of London', lat: 51.5081, lon: -0.0759 },
  stPauls: { name: "St Paul's Cathedral", lat: 51.5138, lon: -0.0984 },
  borough: { name: 'Borough Market', lat: 51.5055, lon: -0.091 },
  abbey: { name: 'Westminster Abbey', lat: 51.4993, lon: -0.1273 },
  nhm: { name: 'Natural History Museum', lat: 51.4967, lon: -0.1764 },
  kensington: { name: 'Kensington Palace', lat: 51.5058, lon: -0.1877 },
  gallery: { name: 'National Gallery', lat: 51.5089, lon: -0.1283 },
  heathrow: { name: 'London Heathrow', lat: 51.47, lon: -0.4543 },
}

let n = 0
const id = (p: string) => `${p}-${++n}`

export async function makeTrip(over: Partial<Trip> = {}, cities: Record<string, string> = {}): Promise<Trip> {
  const trip: Trip = {
    id: id('trip'),
    name: 'Test trip',
    coverEmoji: '🧪',
    startDate: '2027-03-10',
    endDate: '2027-03-12',
    countryCodes: ['GB'],
    cities: ['London'],
    travellers: [],
    style: 'balanced',
    budgetLevel: 'mid',
    budget: {},
    interests: [],
    notes: '',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  } as Trip
  await db.trips.put(trip)
  const days: Day[] = []
  for (let d = trip.startDate; d <= trip.endDate; d = nextDay(d)) {
    const city = cities[d] ?? 'London'
    days.push({ id: `${trip.id}:${d}`, tripId: trip.id, date: d, city, ...(city === 'London' ? LONDON.centre : {}) })
  }
  await db.days.bulkPut(days)
  return trip
}

export function nextDay(d: string) {
  const t = new Date(d + 'T12:00:00Z')
  t.setUTCDate(t.getUTCDate() + 1)
  return t.toISOString().slice(0, 10)
}

export async function addItem(trip: Trip, over: Partial<Item> & { title: string; date: string }): Promise<Item> {
  const it: Item = { id: id('item'), tripId: trip.id, kind: 'activity', status: 'planned', order: n, ...over } as Item
  await db.items.put(it)
  return it
}

export async function addFav(trip: Trip, over: Partial<Favorite> & { name: string }): Promise<Favorite> {
  const f: Favorite = { id: id('fav'), tripId: trip.id, city: 'London', category: 'attraction', visitMin: 60, source: 'sight', addedAt: 0, ...over } as Favorite
  await db.favorites.put(f)
  return f
}

export const at = (p: { name: string; lat: number; lon: number }) => ({ name: p.name, lat: p.lat, lon: p.lon })
export const dayItems = async (trip: Trip, date: string) =>
  (await db.items.where({ tripId: trip.id, date }).toArray()).sort((a, b) => (a.startTime ?? '99').localeCompare(b.startTime ?? '99'))
export const mins = (hhmm?: string) => (hhmm ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) : NaN)
