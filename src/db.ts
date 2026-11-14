import Dexie, { type EntityTable } from 'dexie'
import { carKind } from './lib/drive'
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
