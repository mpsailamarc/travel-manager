import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { db, touchTrip } from '../db'
import type { Item, Place, WalkRoute, WalkStop } from '../types'
import { fetchPois, POI_CATEGORIES, walkingRoute, wikiSummary, type Poi } from '../lib/apis'
import { addDays, dateRange, formatDate, formatDuration, hhmmToMin, minToHHMM } from '../lib/dates'
import { distance } from '../lib/format'
import { haversineM, optimiseOrder, type LatLon } from '../lib/geo'
import { useAsync, useOnline } from '../lib/hooks'
import { uid } from '../lib/ids'
import { PlaceSearch } from '../components/PlaceSearch'
import { Empty, toast } from '../components/ui'
import LazyMap, { type MapMarker } from '../components/LazyMap'
import { tripadvisorSearch } from '../lib/links'
import { useTripCtx } from './TripLayout'

export default function WalkPage() {
  const { trip, items, days, settings } = useTripCtx()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const online = useOnline()
  const existing = items.find((i) => i.id === params.get('item') && i.kind === 'walk')
  const [date, setDate] = useState(existing?.date ?? params.get('date') ?? trip.startDate)
  const day = days.find((d) => d.date === date)
  const stay = items.find((i) => i.kind === 'stay' && i.date <= date && date < addDays(i.date, i.nights ?? 1) && i.location?.lat != null)

  const initialCenter = (): LatLon | undefined => {
    const s = existing?.walk?.stops[0] ?? existing?.walk?.start
    if (s?.lat != null && s.lon != null) return { lat: s.lat, lon: s.lon }
    if (day?.lat != null && day.lon != null) return { lat: day.lat, lon: day.lon }
    return undefined
  }

  const [center, setCenter] = useState<LatLon | undefined>(initialCenter)
  const [mapCenter, setMapCenter] = useState<LatLon | undefined>(center)
  const [radius, setRadius] = useState(2000)
  const [cats, setCats] = useState<string[]>(Object.keys(POI_CATEGORIES))
  const [stops, setStops] = useState<WalkStop[]>(existing?.walk?.stops ?? [])
  const [start, setStart] = useState<Place | undefined>(
    existing?.walk?.start ?? (stay?.location ? { ...stay.location, name: `${stay.title}` } : day?.lat != null ? { name: `${day.city ?? 'City'} centre`, lat: day.lat, lon: day.lon } : undefined),
  )
  const [roundTrip, setRoundTrip] = useState(existing?.walk?.roundTrip ?? false)
  const [startTime, setStartTime] = useState(existing?.startTime ?? '10:00')
  const [route, setRoute] = useState<WalkRoute | undefined>(existing?.walk?.geometry.length ? existing.walk : undefined)
  const [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState<Poi | WalkStop>()
  const [title, setTitle] = useState(existing?.title ?? `${day?.city ?? 'City'} walk`)
  const [cityQuery, setCityQuery] = useState<Place | undefined>()

  const { data: pois, error: poiError, loading } = useAsync(
    () => (center ? fetchPois(center, radius) : Promise.resolve([] as Poi[])),
    [center?.lat, center?.lon, radius],
  )

  // Invalidate a computed route when the stop list changes.
  useEffect(() => {
    if (route && route.stops.map((s) => s.id).sort().join() !== stops.map((s) => s.id).sort().join()) setRoute(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops])

  const selectedIds = new Set(stops.map((s) => s.id))
  const visible = useMemo(() => (pois ?? []).filter((p) => cats.includes(p.category)), [pois, cats])

  const toggle = (p: Poi | WalkStop) =>
    setStops((s) => (s.some((x) => x.id === p.id) ? s.filter((x) => x.id !== p.id) : [...s, { id: p.id, name: p.name, lat: p.lat, lon: p.lon, category: p.category, visitMin: p.visitMin, wikipedia: p.wikipedia, wikidata: p.wikidata }]))

  const ordered = route?.stops ?? stops

  const markers = useMemo((): MapMarker[] => {
    const m: MapMarker[] = visible
      .filter((p) => !selectedIds.has(p.id))
      .map((p) => ({ id: p.id, lat: p.lat, lon: p.lon, label: POI_CATEGORIES[p.category]?.emoji, variant: 'dim', title: p.name, onClick: () => setDetail(p) }))
    ordered.forEach((s, i) => m.push({ id: s.id, lat: s.lat, lon: s.lon, label: String(i + 1), variant: 'on', title: s.name, onClick: () => setDetail(s) }))
    if (start?.lat != null && start.lon != null) m.push({ id: 'start', lat: start.lat, lon: start.lon, label: 'S', variant: 'start', title: start.name })
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, stops, route, start])

  async function build() {
    if (!start?.lat || !start.lon || stops.length < 1) return
    setBusy(true)
    const s = { lat: start.lat, lon: start.lon }
    const order = optimiseOrder(s, stops, roundTrip)
    const pts: LatLon[] = [s, ...order, ...(roundTrip ? [s] : [])]
    const speed = (settings.walkSpeedKmh * 1000) / 3600
    try {
      const r = await walkingRoute(pts)
      setRoute({
        start,
        roundTrip,
        stops: order,
        geometry: r.geometry,
        legs: r.legs.map((l) => ({ distanceM: l.distanceM, durationS: l.distanceM / speed })),
        distanceM: r.distanceM,
        walkS: r.distanceM / speed,
        routedBy: 'osrm',
      })
    } catch {
      // Offline or the free router is busy: straight lines with a 1.3× detour factor.
      const legs = pts.slice(1).map((p, i) => {
        const d = haversineM(pts[i], p) * 1.3
        return { distanceM: d, durationS: d / speed }
      })
      const total = legs.reduce((a, l) => a + l.distanceM, 0)
      setRoute({ start, roundTrip, stops: order, geometry: pts.map((p) => [p.lon, p.lat]), legs, distanceM: total, walkS: total / speed, routedBy: 'straight-line' })
      toast('Routing service unavailable — showing straight-line estimate')
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!route) return
    const visitMin = route.stops.reduce((a, s) => a + s.visitMin, 0)
    const endTime = minToHHMM(hhmmToMin(startTime) + route.walkS / 60 + visitMin)
    const base: Partial<Item> = { title, date, startTime, endTime, walk: route, location: { name: route.stops[0]?.name ?? title, lat: route.stops[0]?.lat, lon: route.stops[0]?.lon } }
    if (existing) {
      await db.items.update(existing.id, base)
    } else {
      const sameDay = items.filter((i) => i.date === date)
      await db.items.add({ id: uid(), tripId: trip.id, kind: 'walk', status: 'planned', order: sameDay.length, ...base } as Item)
    }
    await touchTrip(trip.id)
    toast('Walk saved to the plan')
    navigate(`../today?date=${date}`)
  }

  // Timeline: leave the start, walk, visit each stop.
  const timeline = useMemo(() => {
    if (!route) return []
    let t = hhmmToMin(startTime)
    return route.stops.map((s, i) => {
      const leg = route.legs[i]
      t += (leg?.durationS ?? 0) / 60
      const arrive = t
      t += s.visitMin
      return { stop: s, leg, arrive: minToHHMM(arrive), leave: minToHHMM(t) }
    })
  }, [route, startTime])
  const back = route?.roundTrip ? route.legs[route.legs.length - 1] : undefined

  return (
    <div className="stack">
      <div className="card tight row wrap">
        <label style={{ minWidth: 170 }}>
          Day
          <select value={date} onChange={(e) => setDate(e.target.value)}>
            {dateRange(trip.startDate, trip.endDate).map((d, i) => (
              <option key={d} value={d}>
                Day {i + 1} · {formatDate(d)} {days.find((x) => x.date === d)?.city ? `· ${days.find((x) => x.date === d)?.city}` : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="grow" style={{ minWidth: 220 }}>
          <PlaceSearch
            label="City or neighbourhood"
            value={cityQuery ?? (day?.city ? { name: day.city, lat: day.lat, lon: day.lon } : undefined)}
            onChange={(p) => {
              setCityQuery(p)
              if (p?.lat != null && p.lon != null) {
                setCenter({ lat: p.lat, lon: p.lon })
                if (!start) setStart({ name: `${p.name} centre`, lat: p.lat, lon: p.lon })
              }
            }}
            placeholder="e.g. Rome, Trastevere"
          />
        </div>
        <label style={{ width: 130 }}>
          Search radius
          <select value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
            <option value={1000}>1 km</option>
            <option value={2000}>2 km</option>
            <option value={3500}>3.5 km</option>
          </select>
        </label>
      </div>

      {!center && (
        <div className="card">
          <Empty emoji="🏙️" title="Which city?">
            Search for a city above (tap “Find”), or set the day's city on the Plan tab.
          </Empty>
        </div>
      )}

      {center && (
        <div className="grid-2">
          <div className="stack">
            <LazyMap
              className="tall"
              markers={markers}
              line={route?.geometry}
              dashed={route?.routedBy === 'straight-line'}
              center={center}
              zoom={14}
              fitKey={route ? `route-${route.distanceM}` : `c-${center.lat}-${visible.length}`}
              onMoveEnd={setMapCenter}
              locate
            />
            <div className="row wrap">
              {mapCenter && haversineM(mapCenter, center) > radius / 2 && (
                <button className="btn-sm" onClick={() => setCenter(mapCenter)}>
                  🔎 Search this area
                </button>
              )}
              <span className="tiny muted">Tap a sight on the map or in the list to read about it; add the ones you want.</span>
            </div>
            {detail && <PoiDetail poi={detail} selected={selectedIds.has(detail.id)} onToggle={() => toggle(detail)} onClose={() => setDetail(undefined)} />}
          </div>

          <div className="stack">
            <div className="card stack">
              <div className="row between">
                <h3>Your walk {stops.length > 0 && `· ${stops.length} stops`}</h3>
                {stops.length > 0 && (
                  <button className="btn-sm btn-ghost" onClick={() => setStops([])}>
                    Clear
                  </button>
                )}
              </div>
              <div className="form-grid">
                <div className="full">
                  <PlaceSearch label="Start from" value={start} onChange={setStart} near={day?.city} placeholder="Hotel, station…" />
                </div>
                <label>
                  Start time
                  <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </label>
                <label className="inline" style={{ alignSelf: 'end' }}>
                  <input type="checkbox" checked={roundTrip} onChange={(e) => setRoundTrip(e.target.checked)} /> Come back to the start
                </label>
              </div>
              <div className="row wrap">
                {stay?.location && (
                  <button className="btn-sm" onClick={() => setStart({ ...stay.location!, name: stay.title })}>
                    🛏️ From accommodation
                  </button>
                )}
                <button
                  className="btn-sm"
                  onClick={() =>
                    navigator.geolocation?.getCurrentPosition(
                      (p) => setStart({ name: 'My location', lat: p.coords.latitude, lon: p.coords.longitude }),
                      () => toast('Location not available'),
                    )
                  }
                >
                  📍 From my location
                </button>
              </div>

              {route ? (
                <div className="stack" style={{ gap: 8 }}>
                  <div className="info-grid">
                    <div className="info-tile">
                      <div className="k">Walking</div>
                      <div className="v">
                        {distance(route.distanceM)} · {formatDuration(route.walkS)}
                      </div>
                    </div>
                    <div className="info-tile">
                      <div className="k">With visits</div>
                      <div className="v">{formatDuration(route.walkS + route.stops.reduce((a, s) => a + s.visitMin * 60, 0))}</div>
                    </div>
                  </div>
                  {route.routedBy === 'straight-line' && <div className="notice">Estimated with straight lines (no route service). Rebuild when online for real streets.</div>}
                  <div className="timeline">
                    <div className="t-stop">
                      <b>{startTime}</b> · Start: {route.start.name}
                    </div>
                    {timeline.map(({ stop, leg, arrive, leave }, i) => (
                      <div key={stop.id}>
                        {leg && (
                          <div className="t-leg">
                            🚶 {distance(leg.distanceM)} · {formatDuration(leg.durationS)}
                          </div>
                        )}
                        <div className="t-stop row between">
                          <span className="clickable" onClick={() => setDetail(stop)}>
                            <b>{arrive}</b> · {i + 1}. {stop.name}
                          </span>
                          <span className="row" style={{ gap: 4 }}>
                            <VisitMinutes value={stop.visitMin} onChange={(v) => setRoute({ ...route, stops: route.stops.map((x) => (x.id === stop.id ? { ...x, visitMin: v } : x)) })} />
                            <span className="tiny muted nowrap">→ {leave}</span>
                          </span>
                        </div>
                      </div>
                    ))}
                    {back && (
                      <>
                        <div className="t-leg">
                          🚶 {distance(back.distanceM)} · {formatDuration(back.durationS)}
                        </div>
                        <div className="t-stop">
                          <b>{minToHHMM(hhmmToMin(timeline[timeline.length - 1]?.leave ?? startTime) + back.durationS / 60)}</b> · Back at {route.start.name}
                        </div>
                      </>
                    )}
                  </div>
                  <label>
                    Name
                    <input value={title} onChange={(e) => setTitle(e.target.value)} />
                  </label>
                  <div className="row wrap">
                    <button onClick={build} disabled={busy}>
                      ↻ Rebuild
                    </button>
                    <button className="btn-primary" onClick={save}>
                      💾 {existing ? 'Update walk' : `Save to ${formatDate(date)}`}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {stops.length > 0 && (
                    <div className="chips">
                      {stops.map((s) => (
                        <button key={s.id} className="chip on" onClick={() => toggle(s)}>
                          {POI_CATEGORIES[s.category]?.emoji} {s.name} ✕
                        </button>
                      ))}
                    </div>
                  )}
                  <button className="btn-primary" disabled={!stops.length || start?.lat == null || busy} onClick={build}>
                    {busy ? 'Finding the best route…' : start?.lat == null ? 'Set a start point first' : `🧭 Build the best route (${stops.length} stops)`}
                  </button>
                </>
              )}
            </div>

            <div className="card stack">
              <div className="row between">
                <h3>Sights nearby</h3>
                {loading && <span className="small muted">Loading…</span>}
              </div>
              <div className="chips">
                {Object.entries(POI_CATEGORIES).map(([k, c]) => (
                  <button key={k} className={`chip ${cats.includes(k) ? 'on' : ''}`} onClick={() => setCats((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))}>
                    {c.emoji} {c.label}
                  </button>
                ))}
              </div>
              {poiError && <div className="notice error">{online ? 'The free sights service is busy — try again in a minute.' : 'You are offline — sights load when you are back online.'}</div>}
              <div className="poi-list">
                {visible.map((p) => (
                  <div key={p.id} className={`poi ${selectedIds.has(p.id) ? 'on' : ''}`} onClick={() => setDetail(p)}>
                    <span style={{ fontSize: '1.3rem' }}>{POI_CATEGORIES[p.category]?.emoji}</span>
                    <div className="grow">
                      <div className="strong small">{p.name}</div>
                      <div className="tiny muted">
                        {POI_CATEGORIES[p.category]?.label} · {distance(haversineM(center, p))} away · ~{p.visitMin} min
                        {p.openingHours && ` · ${p.openingHours}`}
                      </div>
                    </div>
                    <button
                      className={`btn-sm ${selectedIds.has(p.id) ? 'btn-primary' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggle(p)
                      }}
                    >
                      {selectedIds.has(p.id) ? '✓' : '+'}
                    </button>
                  </div>
                ))}
                {!loading && !poiError && visible.length === 0 && <p className="small muted">No sights found here — try a bigger radius or another area.</p>}
              </div>
              <p className="tiny muted">Sights from OpenStreetMap; descriptions from Wikipedia.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function VisitMinutes({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select className="btn-sm" style={{ width: 82, minHeight: 28, padding: '2px 4px' }} value={value} onChange={(e) => onChange(Number(e.target.value))} title="Time at this stop">
      {[5, 10, 15, 20, 30, 45, 60, 90, 120, 180].map((m) => (
        <option key={m} value={m}>
          {m < 60 ? `${m} min` : `${m / 60} h`}
        </option>
      ))}
    </select>
  )
}

export function PoiDetail({
  poi,
  selected,
  onToggle,
  onClose,
  addLabel = '+ Add to walk',
  removeLabel = 'Remove from walk',
  city,
}: {
  poi: Poi | WalkStop
  selected: boolean
  onToggle: () => void
  onClose: () => void
  addLabel?: string
  removeLabel?: string
  city?: string
}) {
  const { data, loading } = useAsync(() => (poi.wikipedia || poi.wikidata ? wikiSummary(poi) : Promise.resolve(undefined)), [poi.id])
  const p = poi as Poi
  return (
    <div className="card stack" style={{ gap: 8 }}>
      <div className="row-top">
        {data?.thumbnail && <img src={data.thumbnail} alt="" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 10 }} />}
        <div className="grow">
          <div className="row between">
            <h3>{poi.name}</h3>
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
          <div className="tiny muted">
            {POI_CATEGORIES[poi.category]?.emoji} {POI_CATEGORIES[poi.category]?.label}
            {p.openingHours && ` · 🕘 ${p.openingHours}`}
            {p.fee && ` · fee: ${p.fee}`}
          </div>
        </div>
      </div>
      {loading && <p className="small muted">Loading description…</p>}
      {data?.extract && <p className="small">{data.extract.length > 420 ? data.extract.slice(0, 420) + '…' : data.extract}</p>}
      {!loading && !data && p.description && <p className="small">{p.description}</p>}
      <div className="row">
        <button className={selected ? '' : 'btn-primary'} onClick={onToggle}>
          {selected ? removeLabel : addLabel}
        </button>
        {data?.url && (
          <a className="btn btn-ghost" href={data.url} target="_blank" rel="noreferrer">
            Wikipedia ↗
          </a>
        )}
        {city && (
          <a className="btn btn-ghost" href={tripadvisorSearch(poi.name, city)} target="_blank" rel="noreferrer">
            🦉 Tripadvisor ↗
          </a>
        )}
      </div>
    </div>
  )
}
