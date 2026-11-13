import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, touchTrip } from '../db'
import type { Day, Favorite } from '../types'
import { forecast } from '../lib/apis'
import { categoryMeta, isIndoor, sameCity } from '../lib/favorites'
import { formatDuration } from '../lib/dates'
import { distance } from '../lib/format'
import { haversineM } from '../lib/geo'
import { useAsync } from '../lib/hooks'
import { uid } from '../lib/ids'
import { toast } from './ui'

/** Favourites not on any day, near today's city — the fallback list when plans change. */
export function BackupIdeas({ tripId, day }: { tripId: string; day: Day }) {
  const favs = useLiveQuery(() => db.favorites.where('tripId').equals(tripId).toArray(), [tripId])
  const { data: wx } = useAsync(() => (day.lat != null && day.lon != null ? forecast({ lat: day.lat, lon: day.lon }) : Promise.resolve(undefined)), [day.lat, day.lon])
  const rainy = (wx?.find((w) => w.date === day.date)?.rainChance ?? 0) >= 50
  const [indoorOnly, setIndoorOnly] = useState<boolean>()
  const onlyIndoor = indoorOnly ?? rainy

  const here = (favs ?? []).filter(
    (f) => !f.date && (sameCity(f.city, day.city) || (day.lat != null && f.lat != null && haversineM({ lat: day.lat, lon: day.lon! }, { lat: f.lat, lon: f.lon! }) < 15000)),
  )
  if (!here.length) return null
  const dist = (f: Favorite) => (day.lat != null && f.lat != null ? haversineM({ lat: day.lat, lon: day.lon! }, { lat: f.lat, lon: f.lon! }) : Infinity)
  const list = here.filter((f) => !onlyIndoor || isIndoor(f)).sort((a, b) => dist(a) - dist(b))

  async function addToday(f: Favorite) {
    const sameDay = await db.items.where({ tripId, date: day.date }).toArray()
    const id = uid()
    await db.items.add({
      id,
      tripId,
      date: day.date,
      kind: f.category === 'food' ? 'meal' : 'activity',
      title: f.name,
      location: { name: f.name, lat: f.lat, lon: f.lon },
      status: 'planned',
      order: sameDay.reduce((m, i) => Math.max(m, i.order), -1) + 1,
      notes: f.notes,
    })
    await db.favorites.update(f.id, { date: day.date, pinned: true, itemId: id })
    await touchTrip(tripId)
    toast(`Added ${f.name} to the day`)
  }

  return (
    <div className="card stack" style={{ gap: 8 }}>
      <div className="row between wrap">
        <h3>{rainy ? '☔ Rain likely — backup ideas' : '🧺 Backup ideas nearby'}</h3>
        <div className="chips">
          <button className={`chip ${!onlyIndoor ? 'on' : ''}`} onClick={() => setIndoorOnly(false)}>
            All
          </button>
          <button className={`chip ${onlyIndoor ? 'on' : ''}`} onClick={() => setIndoorOnly(true)}>
            Indoor
          </button>
        </div>
      </div>
      {list.length === 0 && <p className="small muted">No indoor favourites here — try “All”, or add some in Favourites.</p>}
      {list.slice(0, 6).map((f) => (
        <div key={f.id} className="row">
          <span style={{ fontSize: '1.2rem' }}>{categoryMeta(f.category).emoji}</span>
          <div className="grow">
            <div className="small strong">{f.name}</div>
            <div className="tiny muted">
              ~{formatDuration(f.visitMin * 60)}
              {isIndoor(f) && ' · indoor'}
              {dist(f) < Infinity && ` · ${distance(dist(f))} from the centre`}
            </div>
          </div>
          {f.lat != null && (
            <a className="btn btn-sm btn-ghost" href={`https://www.google.com/maps/dir/?api=1&destination=${f.lat},${f.lon}&travelmode=walking`} target="_blank" rel="noreferrer" aria-label="Directions">
              🧭
            </a>
          )}
          <button className="btn-sm" onClick={() => addToday(f)}>
            + Today
          </button>
        </div>
      ))}
      <Link to={`../favorites?city=${encodeURIComponent(day.city ?? '')}`} className="small">
        All favourites →
      </Link>
    </div>
  )
}
