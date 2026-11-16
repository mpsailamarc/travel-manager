import { useEffect, useRef, useState } from 'react'
import { db, touchTrip } from '../db'
import type { Day, Item, ItemStatus, Place, Trip } from '../types'
import { addDays, formatDate } from '../lib/dates'
import { plural } from '../lib/format'
import { uid } from '../lib/ids'
import { bookingSearch } from '../lib/checklist'
import { findPlace } from '../lib/apis'
import { haversineM } from '../lib/geo'
import { isPlaceholderStay, nightsOf } from '../lib/stays'
import { Modal, StatusBadge, toast } from './ui'
import { PlaceSearch } from './PlaceSearch'

const short = (d: string) => formatDate(d, { weekday: 'short', day: 'numeric', month: 'short' })

/** An address that was typed but never looked up (no point, or the point it had before): a place found by Find has its country. */
const needsLookup = (p: Place, city: string) => !!p.name && (p.lat == null || !p.country) && p.name !== `${city} centre`

/** The first search result, unless it's far from where the stay already was (a namesake in another town). */
async function lookUp(p: Place, city: string) {
  const hits = await findPlace(p.name, city)
  return hits.find((h) => p.lat == null || p.lon == null || haversineM({ lat: p.lat, lon: p.lon }, h) < 50_000)
}

/**
 * Hotels whose address was typed without being looked up (before saving did it) are looked up once, in the background,
 * so their days start and end at the real address.
 */
function useLookUpTypedHotels(stays: Item[], cityOf: (s: Item) => string) {
  const done = useRef(new Set<string>())
  useEffect(() => {
    const todo = stays.filter((s) => s.hotelSet && s.location && needsLookup(s.location, cityOf(s)) && !done.current.has(s.id))
    if (!todo.length) return
    void (async () => {
      for (const s of todo) {
        done.current.add(s.id)
        const hit = await lookUp(s.location!, cityOf(s))
        if (hit) await db.items.update(s.id, { location: { name: s.location!.name, lat: hit.lat, lon: hit.lon, country: hit.countryCode } })
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stays.map((s) => `${s.id}:${s.location?.name}`).join()])
}

/**
 * Where you sleep, in one place: one row per stay (normally one per city). Enter the hotel here — its name and address,
 * booked or not, the price — and the rest follows: each day starts and ends there, the checklist and the budget use it.
 */
export function StaysCard({ trip, items, days, currency }: { trip: Trip; items: Item[]; days: Day[]; currency: string }) {
  const [editing, setEditing] = useState<Item>()
  const stays = items
    .filter((i) => i.kind === 'stay' && i.status !== 'skipped' && nightsOf(i).some((n) => n >= trip.startDate && n < trip.endDate))
    .sort((a, b) => a.date.localeCompare(b.date))
  const cityOf = (s: Item) => days.find((d) => d.date === s.date)?.city ?? s.location?.name ?? ''
  useLookUpTypedHotels(stays, cityOf)
  if (!stays.length) return null
  const adults = Math.max(1, trip.travellers.filter((t) => t.type === 'adult').length)
  const kids = trip.travellers.filter((t) => t.type === 'child').map((t) => t.age ?? 8)
  const toChoose = stays.filter(isPlaceholderStay).length
  const booked = stays.filter((s) => s.status === 'booked').length
  return (
    <div className="card stack" style={{ gap: 8 }}>
      <div className="row between wrap">
        <b>🏨 Where you sleep</b>
        <span className="tiny muted">
          {plural(stays.reduce((n, s) => n + (s.nights ?? 1), 0), 'night')}
          {booked > 0 && ` · ${booked} booked`}
          {toChoose > 0 && ` · ${toChoose} to choose`}
        </span>
      </div>
      {stays.map((s) => {
        const n = s.nights ?? 1
        const city = cityOf(s)
        return (
          <div key={s.id} className="row" style={{ alignItems: 'center' }}>
            <button type="button" className="grow btn-ghost" style={{ textAlign: 'left', padding: '4px 0', minHeight: 0, border: 0 }} onClick={() => setEditing(s)}>
              <div className="small strong">
                {city} · {short(s.date)} → {short(addDays(s.date, n))} · {plural(n, 'night')}
              </div>
              <div className="tiny muted">
                {isPlaceholderStay(s) ? '✏️ Hotel to choose — tap to enter it' : s.title}
                {!isPlaceholderStay(s) && s.location?.name && s.location.name !== s.title && ` · ${s.location.name}`}
                {s.location?.lat == null && ' · 📍 no address yet'}
              </div>
            </button>
            <StatusBadge status={s.status} />
            {s.status !== 'booked' && city && (
              <a className="btn btn-sm btn-ghost" href={s.url ?? bookingSearch(city, s.date, addDays(s.date, n), adults, kids)} target="_blank" rel="noreferrer" title="Find a hotel for these nights">
                Booking ↗
              </a>
            )}
          </div>
        )
      })}
      <p className="tiny muted" style={{ margin: 0 }}>
        Each day starts at last night's hotel and ends at tonight's (at the city centre until you enter the address). The checklist and budget follow.
      </p>
      {editing && <StayEditor stay={editing} city={cityOf(editing)} currency={currency} onClose={() => setEditing(undefined)} />}
    </div>
  )
}

function StayEditor({ stay: s, city, currency, onClose }: { stay: Item; city: string; currency: string; onClose: () => void }) {
  const placeholder = isPlaceholderStay(s)
  const [name, setName] = useState(placeholder ? '' : s.title)
  const [place, setPlace] = useState<Place | undefined>(placeholder || s.location?.name === `${city} centre` ? undefined : s.location)
  const [nights, setNights] = useState(s.nights ?? 1)
  const [status, setStatus] = useState<ItemStatus>(s.status)
  const [price, setPrice] = useState(s.cost?.amount ? String(s.cost.amount) : '')
  const [url, setUrl] = useState(s.url ?? '')
  const [ref, setRef] = useState(s.bookingRef ?? '')
  const [splitAt, setSplitAt] = useState(1)

  async function save() {
    const title = name.trim() || place?.name || s.title
    // An address typed without tapping Find is looked up now, so the days really start and end there; if it can't be
    // found (offline, a typo), the stay keeps its old point and says so.
    let location = place?.name ? place : s.location
    if (place?.name && needsLookup(place, city)) {
      const hit = await lookUp({ ...place, lat: place.lat ?? s.location?.lat, lon: place.lon ?? s.location?.lon }, city)
      if (hit) location = { name: place.name, lat: hit.lat, lon: hit.lon, country: hit.countryCode }
      else {
        location = { ...place, lat: s.location?.lat, lon: s.location?.lon }
        toast("Couldn't find that address: the days start from the city centre until you tap Find with a different spelling")
      }
    }
    await db.items.update(s.id, {
      title,
      location,
      nights: Math.max(1, nights),
      status,
      cost: price ? { amount: Number(price), currency: s.cost?.currency ?? currency } : undefined,
      url: url.trim() || undefined,
      bookingRef: ref.trim() || undefined,
      hotelSet: true,
    })
    await touchTrip(s.tripId)
    toast(`🏨 ${title} saved · days in ${city} start and end there`)
    onClose()
  }

  // Changing hotel part-way: this stay keeps the first nights, a new one (to choose) takes the rest.
  async function split() {
    const n = s.nights ?? 1
    if (splitAt < 1 || splitAt >= n) return
    await db.items.update(s.id, { nights: splitAt, hotelSet: true })
    await db.items.add({
      id: uid(),
      tripId: s.tripId,
      date: addDays(s.date, splitAt),
      kind: 'stay',
      title: `Second hotel in ${city} (to choose)`,
      nights: n - splitAt,
      status: 'idea',
      order: s.order,
      location: s.location?.lat != null ? { name: `${city} centre`, lat: s.location.lat, lon: s.location.lon } : undefined,
      hotelSet: true,
    })
    await touchTrip(s.tripId)
    toast(`Split: ${plural(splitAt, 'night')} here, then ${plural(n - splitAt, 'night')} at a second hotel to choose`)
    onClose()
  }

  const n = s.nights ?? 1
  return (
    <Modal title={`🏨 ${city} · ${short(s.date)} → ${short(addDays(s.date, nights))}`} onClose={onClose}>
      <div className="stack">
        <label>
          Hotel name
          <input value={name} placeholder={`e.g. Hotel in ${city}`} onChange={(e) => setName(e.target.value)} />
        </label>
        <PlaceSearch label="Address (or the hotel's name), then Find" value={place} onChange={setPlace} near={city} placeholder="Street, area or hotel name" />
        <p className="tiny muted" style={{ margin: 0 }}>
          {place?.lat != null ? '📍 Placed on the map: each day here starts and ends at this address.' : 'Tap Find so the days start and end at the hotel; until then they use the city centre.'}
        </p>
        <div className="form-grid">
          <label>
            Nights
            <input type="number" min={1} max={60} value={nights} onChange={(e) => setNights(Math.max(1, Number(e.target.value)))} />
          </label>
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value as ItemStatus)}>
              <option value="idea">Idea</option>
              <option value="planned">To book</option>
              <option value="booked">Booked</option>
            </select>
          </label>
          <label>
            Price ({s.cost?.currency ?? currency}, all nights)
            <input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label>
            Booking reference
            <input value={ref} onChange={(e) => setRef(e.target.value)} />
          </label>
          <label className="full">
            Link (booking or hotel page)
            <input value={url} placeholder="https://…" onChange={(e) => setUrl(e.target.value)} />
          </label>
        </div>
        {n > 1 && (
          <details className="card tight">
            <summary className="small" style={{ cursor: 'pointer' }}>
              Changing hotel part-way?
            </summary>
            <div className="row wrap" style={{ marginTop: 8 }}>
              <select value={splitAt} onChange={(e) => setSplitAt(Number(e.target.value))} style={{ width: 'auto' }}>
                {Array.from({ length: n - 1 }, (_, k) => k + 1).map((k) => (
                  <option key={k} value={k}>
                    From the night of {short(addDays(s.date, k))}
                  </option>
                ))}
              </select>
              <button type="button" className="btn-sm" onClick={split}>
                Split the stay
              </button>
            </div>
          </details>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  )
}
