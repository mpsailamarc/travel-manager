import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { db } from '../db'
import type { Day, Item, Place } from '../types'
import { dateRange, formatDate, today } from '../lib/dates'
import { money } from '../lib/format'
import { ItemRow } from '../components/ItemRow'
import { ItemEditor } from '../components/ItemEditor'
import { Empty, Modal } from '../components/ui'
import { PlaceSearch } from '../components/PlaceSearch'
import LazyMap, { type MapMarker } from '../components/LazyMap'
import { useTripCtx } from './TripLayout'

export default function PlanPage() {
  const { trip, items, days } = useTripCtx()
  const [editing, setEditing] = useState<(Partial<Item> & { date: string }) | null>(null)
  const [dayEdit, setDayEdit] = useState<Day | null>(null)
  const [showMap, setShowMap] = useState(false)
  const dates = dateRange(trip.startDate, trip.endDate)
  const dayByDate = new Map(days.map((d) => [d.date, d]))
  const outside = items.filter((i) => i.date < trip.startDate || i.date > trip.endDate)
  const now = today()

  const { markers, line } = useMemo(() => {
    const markers: MapMarker[] = []
    const line: [number, number][] = []
    dates.forEach((date, i) => {
      const d = dayByDate.get(date)
      if (d?.lat != null && d.lon != null) {
        const last = line[line.length - 1]
        if (!last || last[0] !== d.lon || last[1] !== d.lat) {
          line.push([d.lon, d.lat])
          markers.push({ id: date, lat: d.lat, lon: d.lon, label: String(i + 1), variant: 'on', title: d.city })
        }
      }
    })
    // Item dots go first so the numbered day markers are drawn on top of them.
    const dots: MapMarker[] = []
    for (const it of items) {
      const p = it.location ?? it.to
      if (p?.lat != null && p.lon != null && it.kind !== 'stay') dots.push({ id: it.id, lat: p.lat, lon: p.lon, variant: 'dot', title: it.title })
    }
    return { markers: [...dots, ...markers], line }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, days, trip.startDate, trip.endDate])

  const estimated = items.reduce((s, i) => s + (i.cost?.amount ?? 0), 0)
  const currency = items.find((i) => i.cost)?.cost?.currency

  const map = markers.length > 0 && <LazyMap markers={markers} line={line} dashed fitKey={`${markers.length}`} className="tall" />

  return (
    <div className="grid-2 wide-left">
      <div className="stack">
        <div className="row wrap between no-print">
          <div className="small muted">
            {items.length} items · {items.filter((i) => i.status === 'booked').length} booked
            {estimated > 0 && currency && ` · est. ${money(estimated, currency)}`}
          </div>
          <div className="row">
            {markers.length > 0 && (
              <button className="btn-sm hide-desktop" onClick={() => setShowMap((s) => !s)}>
                🗺️ {showMap ? 'Hide map' : 'Map'}
              </button>
            )}
            <button className="btn-sm" onClick={() => window.print()}>
              🖨️ Print
            </button>
          </div>
        </div>

        {showMap && <div className="hide-desktop">{map}</div>}

        {items.length === 0 && (
          <div className="card">
            <Empty emoji="🗺️" title="Nothing planned yet">
              <p style={{ marginBottom: 12 }}>Get three itinerary ideas from a free chatbot, start from a simple template, or add things day by day.</p>
              <Link to="../ideas" className="btn btn-primary">
                ✨ Get itinerary ideas
              </Link>
            </Empty>
          </div>
        )}

        {dates.map((date, i) => {
          const d = dayByDate.get(date)
          const dayItems = items.filter((it) => it.date === date)
          return (
            <section key={date} id={`day-${date}`} className={`card day-card ${date === now ? 'is-today' : ''}`}>
              <div className="day-head">
                <div className="day-num">
                  <small>Day</small>
                  <b>{i + 1}</b>
                </div>
                <div className="grow clickable" onClick={() => setDayEdit(d ?? { id: `${trip.id}:${date}`, tripId: trip.id, date })}>
                  <div className="strong">
                    {formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}
                    {date === now && <span className="badge done" style={{ marginLeft: 6 }}>Today</span>}
                  </div>
                  <div className="small muted">
                    {[d?.city, d?.title].filter(Boolean).join(' · ') || 'Set city & title ✏️'}
                  </div>
                </div>
                <div className="row no-print">
                  <Link to={`../walk?date=${date}`} className="btn btn-sm btn-ghost" title="Build a walking tour">
                    🚶
                  </Link>
                  <button className="btn-sm" onClick={() => setEditing({ date })}>
                    + Add
                  </button>
                </div>
              </div>
              {d?.notes && <p className="small muted" style={{ marginBottom: 6 }}>{d.notes}</p>}
              <div className="items">
                {dayItems.map((it) => (
                  <ItemRow key={it.id} item={it} onClick={() => setEditing(it)} />
                ))}
                {dayItems.length === 0 && <div className="small muted" style={{ padding: '6px 4px' }}>Free day — add something or leave it open.</div>}
              </div>
            </section>
          )
        })}

        {outside.length > 0 && (
          <section className="card">
            <h3>Outside the trip dates</h3>
            <p className="small muted">These items fall before or after the trip (dates changed?). Edit them to move them to a day.</p>
            <div className="items">
              {outside.map((it) => (
                <ItemRow key={it.id} item={it} onClick={() => setEditing({ ...it, date: trip.startDate })} />
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="sticky-side hide-mobile stack">{map}</div>

      {editing && <ItemEditor trip={trip} item={editing} city={dayByDate.get(editing.date)?.city} onClose={() => setEditing(null)} />}
      {dayEdit && <DayEditor day={dayEdit} onClose={() => setDayEdit(null)} />}
    </div>
  )
}

function DayEditor({ day, onClose }: { day: Day; onClose: () => void }) {
  const [d, setD] = useState(day)
  const [applyAll, setApplyAll] = useState(false)
  const place: Place | undefined = d.city ? { name: d.city, lat: d.lat, lon: d.lon } : undefined

  async function save() {
    await db.days.put(d)
    if (applyAll) {
      // Copy the city to following days that have none (typical for multi-night stays).
      const rest = (await db.days.where('tripId').equals(d.tripId).toArray()).filter((x) => x.date > d.date)
      for (const x of rest.sort((a, b) => a.date.localeCompare(b.date))) {
        if (x.city && x.city !== day.city) break
        await db.days.put({ ...x, city: d.city, lat: d.lat, lon: d.lon })
      }
    }
    onClose()
  }

  return (
    <Modal title={formatDate(day.date, { weekday: 'long', day: 'numeric', month: 'long' })} onClose={onClose}>
      <div className="stack">
        <PlaceSearch label="City / base for the day" value={place} onChange={(p) => setD({ ...d, city: p?.name, lat: p?.lat, lon: p?.lon })} placeholder="e.g. Kyoto" />
        <label>
          Title
          <input value={d.title ?? ''} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="e.g. Temples & tea" />
        </label>
        <label>
          Notes
          <textarea style={{ minHeight: 70 }} value={d.notes ?? ''} onChange={(e) => setD({ ...d, notes: e.target.value })} />
        </label>
        <label className="inline">
          <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} />
          Also use this city for the following days (until another city is set)
        </label>
        <p className="tiny muted">Tap “Find” to attach coordinates — used for weather, the map and walking tours.</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  )
}
