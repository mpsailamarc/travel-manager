// Spotting "the same thing twice" in a plan: the planned flight and the imported booking of that flight, the camper van
// pickup from the itinerary and from the rental confirmation… and merging them into one item that has the best of both.

import { db, touchTrip } from '../db'
import type { Item, ItemStatus } from '../types'
import { hhmmToMin } from './dates'
import { haversineM } from './geo'
import { saveLocal } from './storage'

// Words that say what kind of thing it is, not which one: they never decide whether two titles match.
const GENERIC = new Set(
  'the and an to from at in of on for with by your our my pick up pickup collect collection rental rent hire drop off dropoff return returning flight flights fly flying booking booked reservation confirmation'.split(' '),
)

function tokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !GENERIC.has(w)),
  )
}

// Words common to many place names: a single one of them never makes two names "the same place".
const WEAK = new Set('museum tower castle church palace park square garden gardens market bridge cathedral monastery national city old town center centre street tour visit walk lunch dinner breakfast'.split(' '))

/**
 * Is this plan item the wishlist place? Same spot (within 150 m), or the place's name is contained in the item's title/location
 * (or in the names of a walking tour's stops). Hotels and transport never match.
 */
export function matchesPlace(item: Item, place: { name: string; lat?: number; lon?: number }): boolean {
  if (item.kind === 'stay' || TRANSPORT.has(item.kind) || item.status === 'skipped') return false
  const loc = item.location
  if (place.lat != null && place.lon != null && loc?.lat != null && loc.lon != null && haversineM({ lat: place.lat, lon: place.lon }, { lat: loc.lat, lon: loc.lon }) < 150) return true
  const want = tokens(place.name)
  if (!want.size) return false
  const names = [item.title, loc?.name, ...(item.walk?.stops.map((s) => s.name) ?? [])].filter((x): x is string => !!x)
  return names.some((n) => {
    const have = tokens(n)
    const inter = [...want].filter((w) => have.has(w))
    if (inter.length !== want.size) return false // every word of the place must be there
    return want.size >= 2 || (inter[0].length >= 4 && !WEAK.has(inter[0]))
  })
}

const TRANSPORT = new Set(['flight', 'train', 'bus', 'car', 'drive', 'ferry', 'taxi'])

/** Same kind of item, on the same day, and either about the same thing or at the same time. */
export function isSameItem(a: Pick<Item, 'kind' | 'date' | 'title' | 'startTime'>, b: Pick<Item, 'kind' | 'date' | 'title' | 'startTime'>): boolean {
  if (a.kind !== b.kind || a.date !== b.date) return false
  const ta = tokens(a.title)
  const tb = tokens(b.title)
  const transport = TRANSPORT.has(a.kind) || a.kind === 'stay'
  // A bare "Flight" / "Pick up car" matches any item of that kind and day.
  if (transport && (ta.size === 0 || tb.size === 0)) return true
  if (ta.size === 0 && tb.size === 0) return a.title.trim().toLowerCase() === b.title.trim().toLowerCase()
  const inter = [...ta].filter((w) => tb.has(w)).length
  const min = Math.min(ta.size, tb.size)
  const union = ta.size + tb.size - inter
  // One title contained in the other, or mostly the same words. A single shared word only counts for transport and stays.
  if (min > 0 && inter === min && (min >= 2 || transport)) return true
  if (union > 0 && inter / union >= 0.6) return true
  // Two transports at the same time on the same day are the same journey described twice.
  if (TRANSPORT.has(a.kind) && a.startTime && b.startTime && Math.abs(hhmmToMin(a.startTime) - hhmmToMin(b.startTime)) <= 10) return true
  return false
}

const STATUS_RANK: Record<ItemStatus, number> = { done: 5, booked: 4, planned: 2, idea: 1, skipped: 0 }

/** How much an item knows: the one that knows most is the one to keep. */
function richness(i: Item) {
  return (
    STATUS_RANK[i.status] * 3 +
    (i.bookingRef ? 4 : 0) +
    (i.cost?.amount ? 1 : 0) +
    (i.startTime ? 1 : 0) +
    (i.endTime ? 1 : 0) +
    (i.notes ? 1 : 0) +
    (i.url ? 1 : 0) +
    (i.walk ? 3 : 0)
  )
}

export interface DuplicateGroup {
  key: string // stable, for "these are not duplicates"
  keep: Item
  extras: Item[]
}

export function findDuplicateGroups(items: Item[], notDuplicates: Set<string> = new Set()): DuplicateGroup[] {
  const real = items.filter((i) => i.status !== 'skipped' && !i.planner)
  const groups: Item[][] = []
  for (const it of [...real].sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order)) {
    const g = groups.find((g) => g[0].date === it.date && g.some((x) => isSameItem(x, it)))
    if (g) g.push(it)
    else groups.push([it])
  }
  return groups
    .filter((g) => g.length > 1)
    .map((g) => {
      const sorted = [...g].sort((a, b) => richness(b) - richness(a) || a.order - b.order)
      return { key: g.map((x) => x.id).sort().join('+'), keep: sorted[0], extras: sorted.slice(1) }
    })
    .filter((g) => !notDuplicates.has(g.key))
}

/** The kept item takes whatever it was missing from the others (a booking reference, a time, notes…). */
export function mergeInto(keep: Item, others: Item[]): Item {
  const merged: Item = { ...keep }
  const best = (k: keyof Item) => others.map((o) => o[k]).find((v) => v != null && v !== '')
  for (const k of ['startTime', 'endTime', 'from', 'to', 'location', 'nights', 'bookingRef', 'provider', 'url', 'cost', 'notes', 'walk'] as const) {
    if (merged[k] == null || merged[k] === '') (merged as unknown as Record<string, unknown>)[k] = best(k)
  }
  const top = [keep, ...others].reduce((s, i) => (STATUS_RANK[i.status] > STATUS_RANK[s] ? i.status : s), keep.status)
  merged.status = top
  return merged
}

export async function mergeGroups(tripId: string, groups: DuplicateGroup[]) {
  await db.transaction('rw', [db.items, db.favorites], async () => {
    for (const g of groups) {
      await db.items.put(mergeInto(g.keep, g.extras))
      await db.items.bulkDelete(g.extras.map((e) => e.id))
      // Wishlist places that pointed at (or built) a removed copy follow the kept one, which is then yours, not the planner's.
      const gone = new Set(g.extras.map((e) => e.id))
      const built = new Set([g.keep, ...g.extras].map((e) => e.favId).filter(Boolean))
      const favs = (await db.favorites.where('tripId').equals(tripId).toArray()).filter((f) => (f.itemId && gone.has(f.itemId)) || built.has(f.id))
      await db.favorites.bulkUpdate(favs.map((f) => ({ key: f.id, changes: { itemId: g.keep.id, date: g.keep.date, pinned: true } })))
      if (g.keep.planner) await db.items.update(g.keep.id, { planner: undefined })
    }
  })
  await touchTrip(tripId)
}

const IGNORE_KEY = 'tm-not-duplicates'
export const notDuplicates = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(IGNORE_KEY) ?? '[]'))
  } catch {
    return new Set()
  }
}
export const markNotDuplicates = (keys: string[]) => saveLocal(IGNORE_KEY, JSON.stringify([...new Set([...notDuplicates(), ...keys])]))
