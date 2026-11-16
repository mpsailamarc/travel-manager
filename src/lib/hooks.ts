import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, db, getSettings } from '../db'
import type { Day, Item } from '../types'
import { saveLocal } from './storage'

export function useSettings() {
  return useLiveQuery(() => getSettings(), [], DEFAULT_SETTINGS)
}

export function useTrip(id: string | undefined) {
  return useLiveQuery(() => (id ? db.trips.get(id) : undefined), [id])
}

export function useItems(tripId: string | undefined): Item[] | undefined {
  return useLiveQuery(async () => (tripId ? sortItems(await db.items.where('tripId').equals(tripId).toArray()) : []), [tripId])
}

export function useDays(tripId: string | undefined): Day[] | undefined {
  return useLiveQuery(async () => (tripId ? (await db.days.where('tripId').equals(tripId).toArray()).sort((a, b) => a.date.localeCompare(b.date)) : []), [tripId])
}

/** Items in a day: timed items by time, untimed ones keep their manual order after the previous timed item. */
export function sortItems(items: Item[]): Item[] {
  return [...items].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date)
    if (a.startTime && b.startTime && a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime)
    return a.order - b.order
  })
}

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

/** Re-renders every `ms` so countdowns stay live. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data?: T; error?: Error; loading: boolean } {
  const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>({ loading: true })
  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true }))
    fn().then(
      (data) => alive && setState({ data, loading: false }),
      (error) => alive && setState({ error, loading: false }),
    )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return state
}

export type MapSize = 'small' | 'large' | 'hidden'

/**
 * Small / large / hidden map. It follows Settings (`initial`); a choice made on the screen is remembered there on this
 * device until the setting is changed, which every screen then follows again.
 */
export function useMapSize(storageKey: string, initial: MapSize = 'small') {
  const read = (): MapSize => {
    const [size, base = 'small'] = (localStorage.getItem(storageKey) ?? '').split('|') // "large|small": chosen here, when Settings said small
    return size && base === initial ? (size as MapSize) : initial
  }
  const [size, setSize] = useState<MapSize>(read)
  useEffect(() => setSize(read()), [initial]) // eslint-disable-line react-hooks/exhaustive-deps
  return [
    size,
    (v: MapSize) => {
      setSize(v)
      saveLocal(storageKey, `${v}|${initial}`)
    },
  ] as const
}

export function useMediaQuery(query: string) {
  const [match, setMatch] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const m = matchMedia(query)
    const on = () => setMatch(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [query])
  return match
}
