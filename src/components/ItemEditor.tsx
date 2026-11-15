import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { adoptPlannerItems, db, deleteItem, touchTrip } from '../db'
import type { Item, ItemKind, ItemStatus, Trip } from '../types'
import { addDays, daysBetween, dateRange, formatDate, formatDuration, hhmmToMin, minToHHMM, nowHHMM, today } from '../lib/dates'
import { country, CURRENCIES } from '../lib/countries'
import { uid } from '../lib/ids'
import { KIND_META, STATUS_LABEL, isTransport, needsBooking } from './kinds'
import { Modal, StatusBadge, toast } from './ui'
import { itemSubtitle } from './ItemRow'
import { PlaceSearch } from './PlaceSearch'
import { PlaceInfo } from './PlaceInfo'
import { localWiki } from '../lib/apis'
import { planRipple } from '../lib/ripple'
import { retimeAfter } from '../lib/favorites'
import { journeyNote } from '../lib/dayview'
import { legText, taxiLink, transitLink } from '../lib/legs'
import { distance } from '../lib/format'
import { itemZones, offsetMin, transportSpan, tzAt, tzCity, tzLabel, zonedToUtc } from '../lib/tz'
import { CITIES } from '../lib/cities'
import { useSettings } from '../lib/hooks'


/** Zone choices: "Automatic" (what the places say) or any zone a well-known city lives in, sorted west to east. */
function ZoneSelect({ label, auto, value, date, onChange }: { label: string; auto?: string; value?: string; date: string; onChange: (z?: string) => void }) {
  const at = zonedToUtc(date, '12:00', 'UTC')
  const zones = [...new Set([...CITIES.map((c) => tzAt(c.lat, c.lon)!), ...(value ? [value] : []), ...(auto ? [auto] : [])])]
    .map((z) => ({ z, off: offsetMin(z, at) }))
    .sort((a, b) => a.off - b.off || a.z.localeCompare(b.z))
  return (
    <label>
      {label}
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">Automatic{auto ? ` · ${tzLabel(auto, at)}` : ''}</option>
        {zones.map(({ z }) => (
          <option key={z} value={z}>
            {tzLabel(z, at)}
          </option>
        ))}
      </select>
    </label>
  )
}

/** "3 h behind" / "2 h ahead of": how far one zone is from another at that moment. */
function tzOffsetDiff(a: string, b: string, utcMs: number) {
  const d = (offsetMin(a, utcMs) - offsetMin(b, utcMs)) / 60
  const h = Math.abs(d)
  const label = Number.isInteger(h) ? `${h} h` : `${Math.floor(h)} h ${Math.round((h % 1) * 60)} min`
  return d === 0 ? 'same time as' : `${label} ${d > 0 ? 'ahead of' : 'behind'}`
}

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
  const [newId] = useState(uid) // fixed when the form opens: tapping Save twice saves one item
  const [saving, setSaving] = useState(false)
  const [lockTouched, setLockTouched] = useState(false) // ticked or unticked 📌 yourself: that wins over the automatic lock
  const [it, setIt] = useState<Partial<Item> & { date: string }>({ kind: 'activity', status: 'planned', ...item })
  const set = <K extends keyof Item>(k: K, v: Item[K] | undefined) => setIt((s) => ({ ...s, [k]: v }))
  const kind = (it.kind ?? 'activity') as ItemKind

  const days = useLiveQuery(() => db.days.where('tripId').equals(trip.id).toArray(), [trip.id])
  const zoneCtx = { trip, days: days ?? [] }

  // Transport times are clock times where they happen: departure in the departure place's zone, arrival in the arrival place's.
  const zones = itemZones({ ...it, kind }, zoneCtx)
  const span = isTransport(kind) ? transportSpan({ ...(it as Item), kind }, zoneCtx) : undefined

  /** Changing the start moves the whole item: the end follows, so the duration stays (an overnight flight too). */
  function setStart(v: string) {
    setIt((s) => {
      if (!v || !s.startTime || !s.endTime) return { ...s, startTime: v }
      const duration = (hhmmToMin(s.endTime) - hhmmToMin(s.startTime) + 1440) % 1440
      return { ...s, startTime: v, endTime: minToHHMM(hhmmToMin(v) + duration) }
    })
  }

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
    if (saving) return
    setSaving(true)
    let order = it.order
    if (order == null) {
      const sameDay = await db.items.where({ tripId: trip.id, date: it.date }).toArray()
      order = sameDay.reduce((m, x) => Math.max(m, x.order), -1) + 1
    }
    const full: Item = {
      id: it.id ?? newId,
      tripId: trip.id,
      date: it.date,
      kind,
      title: it.title.trim(),
      status: (it.status ?? 'planned') as ItemStatus,
      order,
      startTime: it.startTime || undefined,
      endTime: it.endTime || undefined,
      fromTz: isTransport(kind) ? it.fromTz || undefined : undefined,
      toTz: isTransport(kind) ? it.toTz || undefined : undefined,
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
      planner: it.planner,
      favId: it.favId,
      legIn: it.legIn,
      // Changing the time by hand pins it there; otherwise the lock is whatever the box says.
      locked: (lockTouched ? it.locked : it.locked || (!isNew && (it.startTime !== item.startTime || it.endTime !== item.endTime) && !!it.startTime)) || undefined,
    }
    await db.items.put(full)
    if (full.planner) await adoptPlannerItems([full.id]) // changed by hand: it is yours now, the City planner leaves it alone
    if (push && ripple.moves.length) {
      await db.items.bulkUpdate(ripple.moves.map((m) => ({ key: m.item.id, changes: { startTime: m.start, endTime: m.end } })))
      await adoptPlannerItems(ripple.moves.map((m) => m.item.id))
    }
    await touchTrip(trip.id)
    // Ticked off or skipped here: the places still to come that day move up, as from the list.
    const retimed =
      !isNew && full.status !== item.status && (full.status === 'done' || full.status === 'skipped')
        ? await retimeAfter(full, settings, full.date === today() ? hhmmToMin(nowHHMM()) : undefined)
        : undefined
    if (retimed) toast(`Saved · ${retimed.moved} later ${retimed.moved === 1 ? 'item' : 'items'} moved ${retimed.shiftMin < 0 ? 'earlier' : 'later'}`, { label: 'Undo', run: retimed.undo })
    else toast(push && ripple.moves.length ? `Saved · pushed ${ripple.moves.length} later item${ripple.moves.length > 1 ? 's' : ''} back` : isNew ? 'Added' : 'Saved')
    onClose()
  }

  async function remove() {
    if (!it.id || !confirm(`Delete "${it.title}"?`)) return
    await deleteItem(it.id) // a wishlist place goes back to the backup list
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
            {isTransport(kind) ? `Departs${zones.from ? ` · ${tzCity(zones.from)} time` : ''}` : kind === 'stay' ? 'Check-in' : 'Starts'}
            <input type="time" value={it.startTime ?? ''} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label>
            {isTransport(kind) ? `Arrives${zones.to ? ` · ${tzCity(zones.to)} time` : ''}` : 'Ends'}
            <input type="time" value={it.endTime ?? ''} onChange={(e) => set('endTime', e.target.value)} />
          </label>
          {['activity', 'meal', 'walk', 'note'].includes(kind) && (
            <label className="inline" style={{ alignSelf: 'end' }}>
              <input type="checkbox" checked={!!it.locked} onChange={(e) => {
                  setLockTouched(true)
                  set('locked', e.target.checked || undefined)
                }} /> 📌 Keep this time
            </label>
          )}
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

        {isTransport(kind) && span && (span.zonesDiffer || span.arrDate !== it.date) && (
          <p className="small" style={{ margin: 0 }}>
            🌏 Travel time <b>{formatDuration(span.durationMin * 60)}</b>
            {span.arrDate > it.date ? ` · lands ${span.arrDate === addDays(it.date, 1) ? 'the next day' : `${daysBetween(it.date, span.arrDate)} days later`}` : span.arrDate < it.date ? ' · lands the day before (date line)' : ''}
            {span.zonesDiffer && ` · ${tzCity(span.fromTz)} is ${tzOffsetDiff(span.fromTz, span.toTz, span.depUtc)} ${tzCity(span.toTz)}`}
          </p>
        )}
        {isTransport(kind) && (
          <div className="form-grid">
            <ZoneSelect label="Departure time zone" auto={zones.auto.from} value={it.fromTz} date={it.date} onChange={(z) => set('fromTz', z)} />
            <ZoneSelect label="Arrival time zone" auto={zones.auto.to} value={it.toTz} date={it.date} onChange={(z) => set('toTz', z)} />
          </div>
        )}

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
                Cost (total for everyone)
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
        {saved.legIn?.geometry?.length && saved.location?.lat != null && saved.location.lon != null && (
          <div className="stack" style={{ gap: 4 }}>
            <p className="small" style={{ margin: 0 }}>
              {legText(saved.legIn, distance)}
              {saved.legIn.fromName ? ` from ${saved.legIn.fromName}` : ''}
            </p>
            <div className="row wrap">
              {[
                { label: '🚇 Public transport (real times)', href: transitLink({ lat: saved.legIn.geometry[0][1], lon: saved.legIn.geometry[0][0] }, { lat: saved.location.lat, lon: saved.location.lon }) },
                { label: '🚕 Uber / taxi', href: taxiLink({ lat: saved.legIn.geometry[0][1], lon: saved.legIn.geometry[0][0] }, { lat: saved.location.lat, lon: saved.location.lon }) },
              ].map((l) => (
                <a key={l.label} className="btn btn-sm btn-ghost" href={l.href} target="_blank" rel="noreferrer">
                  {l.label}
                </a>
              ))}
            </div>
          </div>
        )}
        {journeyNote(saved, zoneCtx) && <p className="small" style={{ margin: 0 }}>🌏 {journeyNote(saved, zoneCtx)}</p>}
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
            <button type="button" onClick={() => navigate(saved.planner && city ? `/trip/${trip.id}/favorites?city=${encodeURIComponent(city)}` : `/trip/${trip.id}/walk?item=${saved.id}`)}>
              {saved.planner ? '🗺️ Change in the City planner' : '🗺️ Open in the walk builder'}
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
