import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { db, touchTrip } from '../db'
import type { Item, ItemKind, ItemStatus, Trip } from '../types'
import { dateRange, formatDate } from '../lib/dates'
import { country, CURRENCIES } from '../lib/countries'
import { uid } from '../lib/ids'
import { KIND_META, STATUS_LABEL, isTransport, needsBooking } from './kinds'
import { Modal, StatusBadge, toast } from './ui'
import { itemSubtitle } from './ItemRow'
import { PlaceSearch } from './PlaceSearch'
import { PlaceInfo } from './PlaceInfo'
import { localWiki } from '../lib/apis'
import { planRipple } from '../lib/ripple'
import { useSettings } from '../lib/hooks'

interface Props {
  trip: Trip
  item: Partial<Item> & { date: string }
  city?: string
  area?: { lat?: number; lon?: number } // the day's city, to check Wikipedia matches are nearby
  onClose: () => void
}

export function ItemEditor({ trip, item, city, area, onClose }: Props) {
  const settings = useSettings()
  const navigate = useNavigate()
  const isNew = !item.id
  const [it, setIt] = useState<Partial<Item> & { date: string }>({ kind: 'activity', status: 'planned', ...item })
  const set = <K extends keyof Item>(k: K, v: Item[K] | undefined) => setIt((s) => ({ ...s, [k]: v }))
  const kind = (it.kind ?? 'activity') as ItemKind

  // A later end time can push the rest of the day back: work out what would move, and let the user decide.
  const dayItems = useLiveQuery(() => db.items.where({ tripId: trip.id, date: it.date }).toArray(), [trip.id, it.date])
  const [push, setPush] = useState(true)
  const ripple = planRipple(dayItems ?? [], { id: it.id, startTime: it.startTime || undefined, endTime: it.endTime || undefined }, isNew ? undefined : { startTime: item.startTime, endTime: item.endTime })
  const dates = dateRange(trip.startDate, trip.endDate)
  const [editOpen, setEditOpen] = useState(isNew)

  async function save() {
    if (!it.title?.trim()) {
      toast('Give it a title first')
      return
    }
    let order = it.order
    if (order == null) {
      const sameDay = await db.items.where({ tripId: trip.id, date: it.date }).toArray()
      order = sameDay.reduce((m, x) => Math.max(m, x.order), -1) + 1
    }
    const full: Item = {
      id: it.id ?? uid(),
      tripId: trip.id,
      date: it.date,
      kind,
      title: it.title.trim(),
      status: (it.status ?? 'planned') as ItemStatus,
      order,
      startTime: it.startTime || undefined,
      endTime: it.endTime || undefined,
      from: isTransport(kind) ? it.from : undefined,
      to: isTransport(kind) ? it.to : undefined,
      location: isTransport(kind) ? undefined : it.location,
      nights: kind === 'stay' ? it.nights ?? 1 : undefined,
      bookingRef: it.bookingRef || undefined,
      provider: it.provider || undefined,
      url: it.url || undefined,
      cost: it.cost?.amount ? it.cost : undefined,
      notes: it.notes || undefined,
      walk: it.walk,
    }
    await db.items.put(full)
    if (push && ripple.moves.length) {
      await db.items.bulkUpdate(ripple.moves.map((m) => ({ key: m.item.id, changes: { startTime: m.start, endTime: m.end } })))
    }
    await touchTrip(trip.id)
    toast(push && ripple.moves.length ? `Saved · pushed ${ripple.moves.length} later item${ripple.moves.length > 1 ? 's' : ''} back` : isNew ? 'Added' : 'Saved')
    onClose()
  }

  async function remove() {
    if (!it.id || !confirm(`Delete "${it.title}"?`)) return
    await db.items.delete(it.id)
    // A favourite added on the day goes back to the backup list.
    const fav = await db.favorites.where('tripId').equals(trip.id).filter((f) => f.itemId === it.id).first()
    if (fav) await db.favorites.update(fav.id, { date: undefined, pinned: false, itemId: undefined })
    await touchTrip(trip.id)
    onClose()
  }

  const saved = item as Item // what's stored; the form below edits a draft copy
  const formAndActions = (
    <>
        <div className="chips">
          {(Object.keys(KIND_META) as ItemKind[]).map((k) => (
            <button key={k} type="button" className={`chip ${kind === k ? 'on' : ''}`} onClick={() => set('kind', k)}>
              {KIND_META[k].emoji} {KIND_META[k].label}
            </button>
          ))}
        </div>

        <label>
          Title
          <input autoFocus={isNew} value={it.title ?? ''} onChange={(e) => set('title', e.target.value)} placeholder={placeholderFor(kind)} />
        </label>

        <div className="form-grid">
          <label>
            Day
            <select value={it.date} onChange={(e) => set('date', e.target.value)}>
              {dates.map((d, i) => (
                <option key={d} value={d}>
                  Day {i + 1} · {formatDate(d)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {isTransport(kind) ? 'Departs' : kind === 'stay' ? 'Check-in' : 'Starts'}
            <input type="time" value={it.startTime ?? ''} onChange={(e) => set('startTime', e.target.value)} />
          </label>
          <label>
            {isTransport(kind) ? 'Arrives' : 'Ends'}
            <input type="time" value={it.endTime ?? ''} onChange={(e) => set('endTime', e.target.value)} />
          </label>
          <label>
            Status
            <select value={it.status} onChange={(e) => set('status', e.target.value as ItemStatus)}>
              {(Object.keys(STATUS_LABEL) as ItemStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {(ripple.moves.length > 0 || ripple.blockedBy) && (
          <div className="notice info stack" style={{ gap: 6 }}>
            {ripple.moves.length > 0 && (
              <>
                <label className="inline" style={{ alignItems: 'flex-start' }}>
                  <input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} style={{ marginTop: 3 }} />
                  <span>
                    <b>Push back the next {ripple.moves.length === 1 ? 'item' : `${ripple.moves.length} items`}</b> so they don't overlap
                  </span>
                </label>
                {ripple.moves.map((m) => (
                  <div key={m.item.id} className="small">
                    {KIND_META[m.item.kind].emoji} {m.item.title}: {m.item.startTime}
                    {m.item.endTime && `–${m.item.endTime}`} → <b>{m.start}</b>
                    {m.end && <b>–{m.end}</b>}
                  </div>
                ))}
              </>
            )}
            {ripple.blockedBy && (
              <div className="small">
                🔒 <b>{ripple.blockedBy.title}</b> is booked for {ripple.blockedBy.startTime}, so items can't be pushed past it. {ripple.moves.length ? 'The ones above fit before it; the rest stay' : 'Nothing is moved'} — check your day still works.
              </div>
            )}
          </div>
        )}

        {isTransport(kind) ? (
          <div className="form-grid">
            <PlaceSearch label="From" value={it.from} onChange={(p) => set('from', p)} placeholder="Station, airport…" />
            <PlaceSearch label="To" value={it.to} onChange={(p) => set('to', p)} placeholder="Station, airport…" />
          </div>
        ) : (
          kind !== 'note' && (
            <PlaceSearch label="Where" value={it.location} onChange={(p) => set('location', p)} placeholder="Name or address" near={city} />
          )
        )}

        <div className="form-grid">
          {kind === 'stay' && (
            <label>
              Nights
              <input type="number" min={1} value={it.nights ?? 1} onChange={(e) => set('nights', Number(e.target.value))} />
            </label>
          )}
          {kind !== 'note' && (
            <>
              <label>
                Booking ref
                <input value={it.bookingRef ?? ''} onChange={(e) => set('bookingRef', e.target.value)} />
              </label>
              <label>
                Cost
                <div className="row">
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={it.cost?.amount ?? ''}
                    onChange={(e) => set('cost', { amount: Number(e.target.value), currency: it.cost?.currency ?? settings.homeCurrency })}
                  />
                  <select
                    style={{ width: 90 }}
                    value={it.cost?.currency ?? settings.homeCurrency}
                    onChange={(e) => set('cost', { amount: it.cost?.amount ?? 0, currency: e.target.value })}
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </label>
            </>
          )}
          <label className="full">
            Link
            <input type="url" value={it.url ?? ''} onChange={(e) => set('url', e.target.value)} placeholder="https://… e.g. an AllTrails trail, booking or ticket page" />
          </label>
          <label className="full">
            Notes
            <textarea style={{ minHeight: 70 }} value={it.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
          </label>
        </div>


        <div className="row between">
          {!isNew ? (
            <button type="button" className="btn-danger btn-ghost" onClick={remove}>
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="row">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={save}>
              Save
            </button>
          </div>
        </div>
    </>
  )

  if (isNew) {
    return (
      <Modal title="Add to the plan" onClose={onClose}>
        <div className="stack">{formAndActions}</div>
      </Modal>
    )
  }

  // Existing item: what it is and where first (Wikipedia, links); the form stays folded until you want it.
  return (
    <Modal
      title={
        <span>
          {KIND_META[saved.kind].emoji} {saved.title}
        </span>
      }
      onClose={onClose}
    >
      <div className="stack">
        <ItemSummary item={saved} />
        {saved.kind !== 'note' && (
          <PlaceInfo
            item={saved}
            city={city}
            area={area?.lat != null && area.lon != null ? { lat: area.lat, lon: area.lon } : undefined}
            lang={localWiki(trip.countryCodes[0])}
            country={country(trip.countryCodes[0])?.name}
          />
        )}
        {saved.kind === 'walk' && (
          <div>
            <button type="button" onClick={() => navigate(`/trip/${trip.id}/walk?item=${saved.id}`)}>
              🗺️ Open in the walk builder
            </button>
          </div>
        )}
        <details className="card tight edit-panel" open={editOpen} onToggle={(e) => setEditOpen(e.currentTarget.open)}>
          <summary>✏️ Edit details</summary>
          <div className="stack" style={{ marginTop: 12 }}>
            {formAndActions}
          </div>
        </details>
        {!editOpen && (
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}

/** Time, status, booking reference and notes at a glance. */
function ItemSummary({ item }: { item: Item }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        {item.startTime && (
          <b>
            {formatDate(item.date)} · {item.startTime}
            {item.endTime && `–${item.endTime}`}
          </b>
        )}
        {!item.startTime && <b>{formatDate(item.date)}</b>}
        {(item.status !== 'planned' || needsBooking(item.kind)) && <StatusBadge status={item.status} />}
        {item.bookingRef && (
          <span className="small">
            Ref <b style={{ fontFamily: 'ui-monospace, monospace', letterSpacing: '0.05em' }}>{item.bookingRef}</b>
          </span>
        )}
      </div>
      {itemSubtitle(item) && <p className="small muted">{itemSubtitle(item)}</p>}
      {item.notes && <p className="small">{item.notes}</p>}
    </div>
  )
}

function placeholderFor(kind: ItemKind) {
  switch (kind) {
    case 'flight':
      return 'e.g. Flight to Rome (AZ 123)'
    case 'train':
      return 'e.g. Train Florence → Venice'
    case 'stay':
      return 'e.g. Hotel near the Duomo'
    case 'meal':
      return 'e.g. Lunch at the market'
    case 'walk':
      return 'e.g. Old town walk'
    default:
      return 'e.g. Visit the cathedral'
  }
}
