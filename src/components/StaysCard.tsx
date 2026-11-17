import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { db, touchTrip } from '../db'
import type { Day, Item, ItemStatus, Place, Trip } from '../types'
import { addDays, formatDate } from '../lib/dates'
import { t, tn } from '../i18n'
import { uid } from '../lib/ids'
import { bookingSearch, campsiteSearch } from '../lib/checklist'
import { findPlace } from '../lib/apis'
import { haversineM } from '../lib/geo'
import { isCampsite, isPlaceholderStay, nightsOf } from '../lib/stays'
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
  // Folded away until you want it (it's mostly filled in once, then forgotten); the choice is remembered on this device.
  const [open, setOpen] = useState(() => localStorage.getItem('tm-stays-open') === '1')
  const toggle = () => {
    localStorage.setItem('tm-stays-open', open ? '0' : '1')
    setOpen(!open)
  }
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
      <div className="row between wrap clickable" onClick={toggle} role="button" aria-expanded={open}>
        <b>
          {open ? '▾' : '▸'} {t('🏨 Where you sleep')}
        </b>
        <span className="tiny muted">
          {tn(stays.reduce((n, s) => n + (s.nights ?? 1), 0), '{n} night', '{n} nights')}
          {booked > 0 && ` · ${t('{n} booked', { n: booked })}`}
          {toChoose > 0 && ` · ${t('{n} to choose', { n: toChoose })}`}
        </span>
      </div>
      {open && stays.map((s) => {
        const n = s.nights ?? 1
        const city = cityOf(s)
        return (
          <div key={s.id} className="row" style={{ alignItems: 'center' }}>
            <button type="button" className="grow btn-ghost" style={{ textAlign: 'left', padding: '4px 0', minHeight: 0, border: 0 }} onClick={() => setEditing(s)}>
              <div className="small strong">
                {isCampsite(s) ? '🏕️ ' : ''}
                {city} · {short(s.date)} → {short(addDays(s.date, n))} · {tn(n, '{n} night', '{n} nights')}
              </div>
              <div className="tiny muted">
                {isPlaceholderStay(s) ? (isCampsite(s) ? t('✏️ Campsite to choose — tap to enter it') : t('✏️ Hotel to choose — tap to enter it')) : s.title}
                {!isPlaceholderStay(s) && s.location?.name && s.location.name !== s.title && ` · ${s.location.name}`}
                {s.location?.lat == null && ` · ${t('📍 no address yet')}`}
              </div>
            </button>
            <StatusBadge status={s.status} />
            {s.status !== 'booked' && city && (
              <a
                className="btn btn-sm btn-ghost"
                href={s.url ?? (isCampsite(s) ? campsiteSearch(city) : bookingSearch(city, s.date, addDays(s.date, n), adults, kids))}
                target="_blank"
                rel="noreferrer"
                title={isCampsite(s) ? t('Campsites around, on the map') : t('Find a hotel for these nights')}
              >
                {isCampsite(s) ? t('Campsites ↗') : t('Booking ↗')}
              </a>
            )}
          </div>
        )
      })}
      {open && <p className="tiny muted" style={{ margin: 0 }}>
        {t('Each day starts where you slept and ends where you sleep that night (at the city centre until you enter the address). The checklist and budget follow.')}{' '}
        <Link to="../ideas?tab=bookings">{t('📧 Import a booking email')}</Link> {t('to fill a stay from its confirmation.')}
      </p>}
      {editing && <StayEditor stay={editing} city={cityOf(editing)} currency={currency} onClose={() => setEditing(undefined)} />}
    </div>
  )
}

export function StayEditor({ stay: s, city, currency, onClose }: { stay: Item; city: string; currency: string; onClose: () => void }) {
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
        toast(t("Couldn't find that address: the days start from the city centre until you tap Find with a different spelling"))
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
    toast(t('🏨 {title} saved · days in {city} start and end there', { title, city }))
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
    toast(t('Split: {first} here, then {second} at a second hotel to choose', { first: tn(splitAt, '{n} night', '{n} nights'), second: tn(n - splitAt, '{n} night', '{n} nights') }))
    onClose()
  }

  const n = s.nights ?? 1
  return (
    <Modal title={`🏨 ${city} · ${short(s.date)} → ${short(addDays(s.date, nights))}`} onClose={onClose}>
      <div className="stack">
        <label>
          {isCampsite(s) ? t('Campsite name') : t('Hotel name')}
          <input value={name} placeholder={isCampsite(s) ? t('e.g. Camping {city}', { city }) : t('e.g. Hotel in {city}', { city })} onChange={(e) => setName(e.target.value)} />
        </label>
        <PlaceSearch label={t("Address (or the hotel's name), then Find")} value={place} onChange={setPlace} near={city} placeholder={t('Street, area or hotel name')} />
        <p className="tiny muted" style={{ margin: 0 }}>
          {place?.lat != null ? t('📍 Placed on the map: each day here starts and ends at this address.') : t('Tap Find so the days start and end at the hotel; until then they use the city centre.')}
        </p>
        <div className="form-grid">
          <label>
            {t('Nights')}
            <input type="number" min={1} max={60} value={nights} onChange={(e) => setNights(Math.max(1, Number(e.target.value)))} />
          </label>
          <label>
            {t('Status')}
            <select value={status} onChange={(e) => setStatus(e.target.value as ItemStatus)}>
              <option value="idea">{t('Idea')}</option>
              <option value="planned">{t('To book')}</option>
              <option value="booked">{t('Booked')}</option>
            </select>
          </label>
          <label>
            {t('Price ({currency}, all nights)', { currency: s.cost?.currency ?? currency })}
            <input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label>
            {t('Booking reference')}
            <input value={ref} onChange={(e) => setRef(e.target.value)} />
          </label>
          <label className="full">
            {t('Link (booking or hotel page)')}
            <input value={url} placeholder="https://…" onChange={(e) => setUrl(e.target.value)} />
          </label>
        </div>
        {n > 1 && (
          <details className="card tight">
            <summary className="small" style={{ cursor: 'pointer' }}>
              {t('Changing hotel part-way?')}
            </summary>
            <div className="row wrap" style={{ marginTop: 8 }}>
              <select value={splitAt} onChange={(e) => setSplitAt(Number(e.target.value))} style={{ width: 'auto' }}>
                {Array.from({ length: n - 1 }, (_, k) => k + 1).map((k) => (
                  <option key={k} value={k}>
                    {t('From the night of {date}', { date: short(addDays(s.date, k)) })}
                  </option>
                ))}
              </select>
              <button type="button" className="btn-sm" onClick={split}>
                {t('Split the stay')}
              </button>
            </div>
          </details>
        )}
        <div className="row between">
          <button
            type="button"
            className="btn-danger btn-ghost"
            onClick={async () => {
              if (!confirm(isCampsite(s) ? t('Delete “{title}”? Its nights get a campsite to choose instead.', { title: s.title }) : t('Delete “{title}”? Its nights get a hotel to choose instead.', { title: s.title }))) return
              await db.items.delete(s.id)
              await touchTrip(s.tripId)
              onClose()
            }}
          >
            {t('Delete')}
          </button>
          <div className="row">
          <button type="button" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="button" className="btn-primary" onClick={save}>
            {t('Save')}
          </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
