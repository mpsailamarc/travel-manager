import Dexie, { type EntityTable } from 'dexie'
import { carKind } from './lib/drive'
import { addDays } from './lib/dates'
import type { ChecklistItem, Day, Expense, Favorite, Item, Settings, Trip, TripDocument } from './types'

export const db = new Dexie('travel-manager') as Dexie & {
  trips: EntityTable<Trip, 'id'>
  days: EntityTable<Day, 'id'>
  items: EntityTable<Item, 'id'>
  checklist: EntityTable<ChecklistItem, 'id'>
  expenses: EntityTable<Expense, 'id'>
  documents: EntityTable<TripDocument, 'id'>
  settings: EntityTable<Settings, 'id'>
  favorites: EntityTable<Favorite, 'id'>
  syncState: EntityTable<{ key: string; hash: string }, 'key'>
}

db.version(1).stores({
  trips: 'id, startDate, updatedAt',
  days: 'id, tripId, [tripId+date]',
  items: 'id, tripId, [tripId+date], kind',
  checklist: 'id, tripId, ruleId',
  expenses: 'id, tripId, date',
  documents: 'id, tripId',
  settings: 'id',
})

db.version(2).stores({
  favorites: 'id, tripId',
})

// What each record looked like at the last successful sync (by hash), to find local changes and deletions.
db.version(3).stores({
  syncState: 'key',
})

// "Car" items that are just driving ("Drive to Yosemite") become self-drives: nothing to book. Rentals stay "car".
db.version(4)
  .stores({})
  .upgrade((tx) =>
    tx
      .table('items')
      .toCollection()
      .modify((i) => {
        if (i.kind === 'car') i.kind = carKind(i.title)
      }),
  )

export const DEFAULT_SETTINGS: Settings = {
  id: 'me',
  name: '',
  homeCurrency: 'EUR',
  nationality: '',
  walkSpeedKmh: 4.5,
}

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await db.settings.get('me')) }
}

export async function touchTrip(tripId: string) {
  await db.trips.update(tripId, { updatedAt: Date.now() })
}

/**
 * After the trip's dates change, the new days carry on from the city of the day next to them (a trip stretched by two days in Lisbon
 * gets two Lisbon days), so they show up in the City planner and the Plan with a place already set.
 */
export async function extendTripDays(tripId: string, was: { startDate: string; endDate: string }, now: { startDate: string; endDate: string }) {
  const days = await db.days.where('tripId').equals(tripId).toArray()
  const byDate = new Map(days.map((d) => [d.date, d]))
  const fill = async (dates: string[], from?: (typeof days)[number]) => {
    if (!from?.city) return
    for (const date of dates) {
      const cur = byDate.get(date)
      if (cur?.city) continue
      await db.days.put({ ...(cur ?? { id: `${tripId}:${date}`, tripId, date }), city: from.city, lat: from.lat, lon: from.lon })
    }
  }
  const after: string[] = []
  for (let d = addDays(was.endDate, 1); d <= now.endDate; d = addDays(d, 1)) after.push(d)
  const before: string[] = []
  for (let d = addDays(was.startDate, -1); d >= now.startDate; d = addDays(d, -1)) before.push(d)
  await fill(after, byDate.get(was.endDate) ?? [...days].filter((d) => d.city && d.date <= was.endDate).sort((a, b) => b.date.localeCompare(a.date))[0])
  await fill(before, byDate.get(was.startDate) ?? [...days].filter((d) => d.city && d.date >= was.startDate).sort((a, b) => a.date.localeCompare(b.date))[0])
}

export async function deleteTrip(tripId: string) {
  await db.transaction('rw', [db.trips, db.days, db.items, db.checklist, db.expenses, db.documents, db.favorites], async () => {
    await db.favorites.where('tripId').equals(tripId).delete()
    await db.days.where('tripId').equals(tripId).delete()
    await db.items.where('tripId').equals(tripId).delete()
    await db.checklist.where('tripId').equals(tripId).delete()
    await db.expenses.where('tripId').equals(tripId).delete()
    await db.documents.where('tripId').equals(tripId).delete()
    await db.trips.delete(tripId)
  })
}

// Ask the browser not to evict our data (important on iOS Safari).
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  if (await navigator.storage.persisted()) return true
  return navigator.storage.persist()
}
