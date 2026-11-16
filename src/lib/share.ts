// Export / import trips as a single JSON file — the zero-cost way to share with relatives.

import { db } from '../db'
import type { ChecklistItem, Day, Expense, Favorite, Item, Trip, TripDocument } from '../types'
import { uid } from './ids'
import { saveLocal } from './storage'
import { t } from '../i18n'

interface ExportedDoc extends Omit<TripDocument, 'blob'> {
  dataUrl: string
}

export interface TripFile {
  app: 'travel-manager'
  version: 1
  exportedAt: string
  trip: Trip
  days: Day[]
  items: Item[]
  checklist: ChecklistItem[]
  expenses: Expense[]
  documents: ExportedDoc[]
  favorites?: Favorite[]
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(b)
  })
}

export async function exportTrip(tripId: string, opts: { documents: boolean; expenses: boolean }): Promise<File> {
  const trip = await db.trips.get(tripId)
  if (!trip) throw new Error(t('Trip not found'))
  const docs = opts.documents ? await db.documents.where('tripId').equals(tripId).toArray() : []
  const file: TripFile = {
    app: 'travel-manager',
    version: 1,
    exportedAt: new Date().toISOString(),
    trip,
    days: await db.days.where('tripId').equals(tripId).toArray(),
    items: await db.items.where('tripId').equals(tripId).toArray(),
    checklist: await db.checklist.where('tripId').equals(tripId).toArray(),
    expenses: opts.expenses ? await db.expenses.where('tripId').equals(tripId).toArray() : [],
    documents: await Promise.all(docs.map(async ({ blob, ...rest }) => ({ ...rest, dataUrl: await blobToDataUrl(blob) }))),
    favorites: await db.favorites.where('tripId').equals(tripId).toArray(),
  }
  const safe = trip.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'trip'
  return new File([JSON.stringify(file, null, 1)], `${safe}.trip.json`, { type: 'application/json' })
}

export function download(file: File) {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

/** Uses the phone's share sheet (WhatsApp, email…) when available, otherwise downloads. */
export async function shareOrDownload(file: File): Promise<'shared' | 'downloaded'> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name })
      return 'shared'
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared'
    }
  }
  download(file)
  return 'downloaded'
}

/** Imports as a new copy (fresh ids), so importing the same file twice never overwrites your edits. */
export async function importTrip(text: string): Promise<string> {
  const f = JSON.parse(text) as TripFile
  if (f.app !== 'travel-manager' || !f.trip) throw new Error(t('This is not a Travel Manager trip file.'))
  const id = uid()
  const itemIds = new Map(f.items.map((i) => [i.id, uid()]))
  const favIds = new Map((f.favorites ?? []).map((v) => [v.id, uid()])) // items point at their wishlist place, so both are remapped
  const docs: TripDocument[] = await Promise.all(
    (f.documents ?? []).map(async ({ dataUrl, ...rest }) => ({ ...rest, id: uid(), tripId: id, blob: await (await fetch(dataUrl)).blob() })),
  )
  await db.transaction('rw', [db.trips, db.days, db.items, db.checklist, db.expenses, db.documents, db.favorites], async () => {
    await db.trips.add({ ...f.trip, id, updatedAt: Date.now() })
    await db.favorites.bulkAdd(
      (f.favorites ?? []).map((v) => ({ ...v, tripId: id, id: favIds.get(v.id)!, itemId: v.itemId ? itemIds.get(v.itemId) : undefined })),
    )
    await db.days.bulkAdd(f.days.map((d) => ({ ...d, tripId: id, id: `${id}:${d.date}` })))
    await db.items.bulkAdd(f.items.map((i) => ({ ...i, tripId: id, id: itemIds.get(i.id)!, favId: i.favId ? favIds.get(i.favId) : undefined })))
    await db.checklist.bulkAdd(
      f.checklist.map((c) => ({
        ...c,
        tripId: id,
        // Rule ids reference item ids (e.g. "book:<itemId>"): remap so regeneration doesn't duplicate.
        ruleId: c.ruleId?.replace(/:(.+)$/, (m, ref) => (itemIds.has(ref) ? `:${itemIds.get(ref)}` : m)),
        id: uid(),
      })),
    )
    await db.expenses.bulkAdd((f.expenses ?? []).map((e) => ({ ...e, tripId: id, id: uid() })))
    await db.documents.bulkAdd(docs)
  })
  return id
}

/**
 * A copy of the trip to try things on ("what if we spent longer in Rome?"): the plan, days, stays, budget, checklist and
 * backup ideas, under a new name. Expenses and documents (tickets, passports) are real records of the trip itself, so
 * they stay with the original. ChatGPT's city ideas kept on this device come along too.
 */
export async function duplicateTrip(tripId: string, name: string): Promise<string> {
  const f = JSON.parse(await (await exportTrip(tripId, { documents: false, expenses: false })).text()) as TripFile
  f.trip = { ...f.trip, name, createdAt: Date.now() }
  // The checklist starts afresh on what to do, not on what was already ticked for the original.
  f.checklist = f.checklist.map((c) => ({ ...c, done: false }))
  const id = await importTrip(JSON.stringify(f))
  for (const k of Object.keys(localStorage)) if (k.startsWith(`tm-cityideas:${tripId}:`)) saveLocal(k.replace(tripId, id), localStorage.getItem(k) ?? '')
  return id
}

export async function exportEverything(): Promise<File> {
  const trips = await db.trips.toArray()
  const files = await Promise.all(trips.map(async (t) => JSON.parse(await (await exportTrip(t.id, { documents: true, expenses: true })).text())))
  const settings = await db.settings.get('me')
  return new File([JSON.stringify({ app: 'travel-manager', kind: 'backup', exportedAt: new Date().toISOString(), settings, trips: files })], `travel-manager-backup-${new Date().toISOString().slice(0, 10)}.json`, {
    type: 'application/json',
  })
}

export async function importAny(text: string): Promise<string[]> {
  const parsed = JSON.parse(text)
  if (parsed.kind === 'backup') {
    if (parsed.settings) await db.settings.put(parsed.settings)
    const ids: string[] = []
    for (const t of parsed.trips as TripFile[]) ids.push(await importTrip(JSON.stringify(t)))
    return ids
  }
  return [await importTrip(text)]
}
