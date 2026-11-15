import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { db } from '../db'
import type { Day, Item, Place } from '../types'
import { dateRange, formatDate, formatDuration, today } from '../lib/dates'
import { distance, money } from '../lib/format'
import { haversineM } from '../lib/geo'
import { drivingRoute, locatePlace } from '../lib/apis'
import { journeyNote } from '../lib/dayview'
import { ItemRow } from '../components/ItemRow'
import { ItemEditor } from '../components/ItemEditor'
import { Empty, Modal, toast } from '../components/ui'
import { PlaceSearch } from '../components/PlaceSearch'
import LazyMap, { type MapMarker } from '../components/LazyMap'
import { useAsync, useMapSize, useMediaQuery } from '../lib/hooks'
import { findDuplicateGroups, markNotDuplicates, mergeGroups, notDuplicates, type DuplicateGroup } from '../lib/duplicates'
import { KIND_META } from '../components/kinds'
import { PlanStaleNotice } from '../components/PlanStale'
import { fillUntimedTrip, untimedItems } from '../lib/favorites'
import { useTripCtx } from './TripLayout'
import { saveLocal } from '../lib/storage'

export default function PlanPage() {
  const { trip, items, days, settings } = useTripCtx()
  const navigate = useNavigate()
  const [editing, setEditing] = useState<(Partial<Item> & { date: string }) | null>(null)
  const [dayEdit, setDayEdit] = useState<Day | null>(null)
  // Headings only (open a day for its detail) or every item, remembered on this device.
  const [detailed, setDetailedState] = useState(() => localStorage.getItem('tm-plan-detail') === '1')
  const setDetailed = (v: boolean) => {
    setDetailedState(v)
    saveLocal('tm-plan-detail', v ? '1' : '0')
  }
  const [mapSize, setMapSize] = useMapSize('tm-plan-map')
  const wide = useMediaQuery('(min-width: 721px)')
  const dates = dateRange(trip.startDate, trip.endDate)
  const dayByDate = new Map(days.map((d) => [d.date, d]))
  const outside = items.filter((i) => i.date < trip.startDate || i.date > trip.endDate)
  const now = today()

  // No start set: it's home (Settings → Home city or usual airport), when that is set. The effect below then locates it.
  useEffect(() => {
    if (!trip.startPlace?.name?.trim() && settings.homeAirport?.trim()) db.trips.update(trip.id, { startPlace: { name: settings.homeAirport.trim() } })
  }, [trip.id, trip.startPlace?.name, settings.homeAirport])

  // A start/return that has a name but no coordinates yet (typed without "Find") is located once, so the map can draw it.
  useEffect(() => {
    const needs = (p?: Place) => !!p?.name.trim() && p.lat == null
    if (!needs(trip.startPlace) && !needs(trip.endPlace)) return
    let alive = true
    Promise.all([locatePlace(trip.startPlace), trip.endPlace?.name ? locatePlace(trip.endPlace) : Promise.resolve(undefined)]).then(([startPlace, endPlace]) => {
      if (alive && (startPlace?.lat != null || endPlace?.lat != null)) db.trips.update(trip.id, { startPlace, endPlace })
    })
    return () => {
      alive = false
    }
  }, [trip.id, trip.startPlace?.name, trip.startPlace?.lat, trip.endPlace?.name, trip.endPlace?.lat])

  // The map can show the whole journey from home (Sydney → … → Sydney) or just the trip itself, zoomed on where you are.
  const [fromHome, setFromHomeState] = useState(() => localStorage.getItem('tm-plan-from-home') !== '0')
  const setFromHome = (v: boolean) => {
    setFromHomeState(v)
    saveLocal('tm-plan-from-home', v ? '1' : '0')
  }

  // "The trip only" leaves out the days spent at home (the departure day in Sydney), unless the whole trip is close to home.
  const homeDay = useMemo(() => {
    const endP = trip.endPlace?.name ? trip.endPlace : trip.startPlace
    const homes = [trip.startPlace, endP].filter((p) => p?.lat != null && p.lon != null).map((p) => ({ lat: p!.lat!, lon: p!.lon! }))
    const atHome = (d: Day) => d.lat != null && d.lon != null && homes.some((h) => haversineM(h, { lat: d.lat!, lon: d.lon! }) < 100_000)
    const away = days.some((d) => d.lat != null && !atHome(d))
    return (d: Day | undefined) => !fromHome && away && !!d && atHome(d)
  }, [days, trip.startPlace, trip.endPlace, fromHome])

  const { markers } = useMemo(() => {
    const markers: MapMarker[] = []
    const line: [number, number][] = []
    dates.forEach((date, i) => {
      const d = dayByDate.get(date)
      if (d?.lat != null && d.lon != null && !homeDay(d)) {
        const last = line[line.length - 1]
        if (!last || last[0] !== d.lon || last[1] !== d.lat) {
          line.push([d.lon, d.lat])
          markers.push({ id: date, lat: d.lat, lon: d.lon, label: String(i + 1), variant: 'on', title: `${d.city ?? ''} · day ${i + 1}: open it`, onClick: () => navigate(`../today?date=${date}`) })
        }
      }
    })
    // The trip's start and return places close the route (unless the map is set to the trip only).
    const start = fromHome && trip.startPlace?.lat != null && trip.startPlace.lon != null ? trip.startPlace : undefined
    const endP = trip.endPlace?.name ? trip.endPlace : trip.startPlace
    const end = fromHome && endP?.lat != null && endP.lon != null ? endP : undefined
    if (start) {
      line.unshift([start.lon!, start.lat!])
      markers.push({ id: 'trip-start', lat: start.lat!, lon: start.lon!, label: 'S', variant: 'start', title: `Start: ${start.name}` })
    }
    if (end) {
      line.push([end.lon!, end.lat!])
      const same = start && start.lat === end.lat && start.lon === end.lon
      if (!same) markers.push({ id: 'trip-end', lat: end.lat!, lon: end.lon!, label: 'E', variant: 'start', title: `Return: ${end.name}` })
    }
    // Item dots go first so the numbered day markers are drawn on top of them.
    const dots: MapMarker[] = []
    // "The trip only": leave out what's far from every day of the trip (the flights' airports at home), so the map zooms on the trip.
    const dayPoints = days.filter((d) => d.lat != null && d.lon != null && !homeDay(d)).map((d) => ({ lat: d.lat!, lon: d.lon! }))
    const onTrip = (p: { lat: number; lon: number }) => fromHome || !dayPoints.length || dayPoints.some((d) => haversineM(d, p) < 250000)
    for (const it of items) {
      const p = it.location ?? it.to
      if (p?.lat != null && p.lon != null && it.kind !== 'stay' && onTrip({ lat: p.lat, lon: p.lon })) dots.push({ id: it.id, lat: p.lat, lon: p.lon, variant: 'dot', title: `${it.title}: open its day`, onClick: () => navigate(`../today?date=${it.date}`) })
    }
    return { markers: [...dots, ...markers], line }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, days, trip.startDate, trip.endDate, trip.startPlace, trip.endPlace, fromHome, homeDay])

  // The trip as a chain of places: start → each city (when it changes) → return. A leg is "by car" when you arrive on a day
  // within the period you have a car (first to last car or drive item); those legs follow the roads, the rest stay straight.
  const carDates = items.filter((i) => (i.kind === 'car' || i.kind === 'drive') && i.status !== 'skipped').map((i) => i.date).sort()
  const carFrom = carDates[0]
  const carTo = carDates[carDates.length - 1]
  const stops = useMemo(() => {
    const out: { name: string; lat: number; lon: number; arrive: string }[] = []
    const push = (name: string, lat: number | undefined, lon: number | undefined, arrive: string) => {
      if (lat == null || lon == null) return
      const last = out[out.length - 1]
      if (!last || last.lat !== lat || last.lon !== lon) out.push({ name, lat, lon, arrive })
    }
    if (fromHome) push(trip.startPlace?.name ?? '', trip.startPlace?.lat, trip.startPlace?.lon, trip.startDate)
    for (const date of dateRange(trip.startDate, trip.endDate)) {
      const d = days.find((x) => x.date === date)
      if (!homeDay(d)) push(d?.city ?? 'Stop', d?.lat, d?.lon, date)
    }
    const endP = trip.endPlace?.name ? trip.endPlace : trip.startPlace
    if (fromHome) push(endP?.name ?? '', endP?.lat, endP?.lon, trip.endDate)
    return out
  }, [days, trip.startDate, trip.endDate, trip.startPlace, trip.endPlace, fromHome, homeDay])
  // How each leg is travelled: a flight or a boat stays a straight dashed line; everything else follows the roads
  // (a train or bus line roughly does too). Colours: car orange, public transport blue, flights grey, boats cyan.
  const legMode = (date: string, byCar: boolean): 'flight' | 'ferry' | 'car' | 'public' => {
    const journeys = items.filter((i) => i.date === date && i.status !== 'skipped' && ['flight', 'ferry', 'train', 'bus', 'car', 'drive'].includes(i.kind))
    if (journeys.some((i) => i.kind === 'flight')) return 'flight'
    if (journeys.some((i) => i.kind === 'ferry')) return 'ferry'
    if (byCar || journeys.some((i) => i.kind === 'car' || i.kind === 'drive')) return 'car'
    return 'public'
  }
  const legs = stops.slice(1).map((to, i) => {
    const byCar = !!carFrom && to.arrive >= carFrom && to.arrive <= carTo
    return { from: stops[i], to, mode: legMode(to.arrive, byCar) }
  })
  const roadLegs = legs.filter((l) => l.mode === 'car' || l.mode === 'public')
  const roadKey = roadLegs.map((l) => `${l.from.lat},${l.from.lon}>${l.to.lat},${l.to.lon}`).join('|')
  const roads = useAsync(() => Promise.all(roadLegs.map((l) => drivingRoute(l.from, l.to).catch(() => undefined))), [roadKey])
  const LEG_STYLE = { car: '#ea580c', public: '#2563eb', flight: '#64748b', ferry: '#0891b2' } as const
  const segments = legs.map((l) => {
    const route = l.mode === 'car' || l.mode === 'public' ? roads.data?.[roadLegs.indexOf(l)] : undefined
    return {
      coords: route ? route.geometry : ([[l.from.lon, l.from.lat], [l.to.lon, l.to.lat]] as [number, number][]),
      dashed: !route,
      color: LEG_STYLE[l.mode],
    }
  })

  // The trip's journeys under the map, in order: flights, boats, trains, buses and drives from the plan, plus legs by car
  // that have no item of their own (with the road distance and time). Each opens its day.
  const JOURNEY_ICON: Partial<Record<Item['kind'], string>> = { flight: '✈️', ferry: '⛴️', train: '🚆', bus: '🚌', drive: '🚗' }
  const journeyList = [
    ...items
      .filter((it) => JOURNEY_ICON[it.kind] && it.status !== 'skipped')
      .map((it) => {
        const leg = it.kind === 'drive' ? legs.find((l) => l.to.arrive === it.date && l.mode === 'car') : undefined
        const route = leg ? roads.data?.[roadLegs.indexOf(leg)] : undefined
        return {
          key: it.id,
          date: it.date,
          time: it.startTime ?? '',
          icon: JOURNEY_ICON[it.kind]!,
          from: it.from?.name ?? leg?.from.name ?? '?',
          to: it.to?.name ?? leg?.to.name ?? '?',
          detail: [it.startTime, it.status === 'booked' ? 'booked' : undefined, route ? `${distance(route.distanceM)} · ${formatDuration(route.durationS)} driving` : undefined].filter(Boolean).join(' · '),
        }
      }),
    ...legs
      .filter((l) => l.mode === 'car' && !items.some((it) => it.kind === 'drive' && it.date === l.to.arrive))
      .map((l) => {
        const route = roads.data?.[roadLegs.indexOf(l)]
        return {
          key: `${l.from.name}>${l.to.name}@${l.to.arrive}`,
          date: l.to.arrive,
          time: '',
          icon: '🚗',
          from: l.from.name || 'Start',
          to: l.to.name || 'End',
          detail: route ? `${distance(route.distanceM)} · ${formatDuration(route.durationS)} driving` : roads.loading ? 'finding the road…' : '',
        }
      }),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))

  const estimated = items.reduce((s, i) => s + (i.cost?.amount ?? 0), 0)
  const currency = items.find((i) => i.cost)?.cost?.currency

  const map = markers.length > 0 && (
    <div className="card stack" style={{ gap: 8 }}>
      <div className="row between">
        <b>🗺️ Map</b>
        <div className="chips">
          {(['small', 'large', 'hidden'] as const).map((v) => (
            <button key={v} className={`chip ${mapSize === v ? 'on' : ''}`} onClick={() => setMapSize(v)}>
              {v === 'small' ? 'Small' : v === 'large' ? 'Large' : 'Hide'}
            </button>
          ))}
        </div>
      </div>
      {mapSize !== 'hidden' && trip.startPlace?.lat != null && (
        <div className="chips">
          <button className={`chip ${fromHome ? 'on' : ''}`} onClick={() => setFromHome(true)}>
            From {trip.startPlace.name.split(',')[0]}
          </button>
          <button className={`chip ${!fromHome ? 'on' : ''}`} onClick={() => setFromHome(false)}>
            The trip only
          </button>
        </div>
      )}
      {mapSize !== 'hidden' && (
        <>
          <LazyMap
            key={mapSize}
            markers={markers}
            segments={segments}
            fitKey={`${markers.length}-${segments.length}-${roads.data?.filter(Boolean).length ?? 0}-${trip.startPlace?.lat}-${trip.endPlace?.lat}-${fromHome}`}
            className={mapSize === 'large' ? 'tall' : 'short'}
          />
          {journeyList.length > 0 && (
            <div className="stack" style={{ gap: 2 }}>
              {journeyList.map((j) => (
                <Link key={j.key} to={`../today?date=${j.date}`} className="small journey-link" title="Open that day">
                  {j.icon} {j.from} → {j.to}
                  <span className="muted">
                    {' · '}
                    {formatDate(j.date, { weekday: 'short', day: 'numeric', month: 'short' })}
                    {j.detail && ` · ${j.detail}`}
                  </span>
                </Link>
              ))}
            </div>
          )}
          <p className="tiny muted">
            <span style={{ color: LEG_STYLE.car }}>━</span> by car · <span style={{ color: LEG_STYLE.public }}>━</span> train / bus ·{' '}
            <span style={{ color: LEG_STYLE.flight }}>┅</span> flight · <span style={{ color: LEG_STYLE.ferry }}>┅</span> boat
          </p>
          <p className="tiny muted">
            {trip.startPlace?.lat != null && (
              <>
                🟠 <b>S</b> start{trip.endPlace?.name ? ' · 🟠 E return' : ' and return'} ·{' '}
              </>
            )}
            Numbers = the first day you are in each place (tap one, or a grey dot, to open that day) · lines follow the roads, except flights and boats (dashed) · grey dots = activities
            {trip.startPlace?.lat == null && ' · Set where you start and finish in Trip details to see them here'}
          </p>
        </>
      )}
    </div>
  )

  // "San Francisco → Yosemite → San Francisco": the shape of the trip at a glance.
  // The trip in a line: Sydney → San Pedro de Atacama → … → Sydney. A day's city loses its details ("Sydney (overnight
  // flight)", "Santiago → Sydney (return)" read as Sydney and Santiago), so each place shows once per visit.
  const base = (c?: string) => (c ?? '').split(/\s*[(/]|\s+(?:→|->)\s+/)[0].trim()
  const places = [trip.startPlace?.name, ...days.map((d) => d.city), trip.endPlace?.name || trip.startPlace?.name].map((c) => base(c?.split(',')[0]))
  const routeLine = places.filter((x, i, a) => !!x && a.slice(0, i).reverse().find(Boolean)?.toLowerCase() !== x.toLowerCase())

  return (
    <div className="grid-2 wide-left">
      <div className="stack">
        <div className="row wrap between no-print">
          <div className="small muted">
            {items.length} items · {items.filter((i) => i.status === 'booked').length} booked
            {estimated > 0 && currency && ` · est. ${money(estimated, currency)}`}
          </div>
          <div className="row">
            <button className="btn-sm" onClick={() => window.print()}>
              🖨️ Print
            </button>
          </div>
        </div>

        <PlanStaleNotice trip={trip} />
        <DuplicatesNotice tripId={trip.id} items={items} />

        {!trip.startPlace?.name && <StartCard tripId={trip.id} />}

        {routeLine.length > 1 && (
          <div className="card tight small">
            📍 <b>{routeLine.join(' → ')}</b>
          </div>
        )}

        {!wide && map}

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

        {items.length > 0 && (
          <div className="row between wrap no-print">
            <h3>Days</h3>
            {dates.some((d) => untimedItems(items, d).length) && (
              <button
                className="btn-sm"
                title="Give a time to every activity, meal and walk that has none, around what already has one"
                onClick={async () => {
                  const n = await fillUntimedTrip(trip.id, settings)
                  toast(n ? `${n} item${n > 1 ? 's' : ''} given a time` : 'No room left on those days: give them a time by hand')
                }}
              >
                ⏱ Give times to {dates.reduce((s, d) => s + untimedItems(items, d).length, 0)} untimed items
              </button>
            )}
            <div className="chips">
              <button className={`chip ${!detailed ? 'on' : ''}`} onClick={() => setDetailed(false)}>
                Headings
              </button>
              <button className={`chip ${detailed ? 'on' : ''}`} onClick={() => setDetailed(true)}>
                Every item
              </button>
            </div>
          </div>
        )}

        {!detailed &&
          dates.map((date, i) => {
            const d = dayByDate.get(date)
            const dayItems = items.filter((it) => it.date === date && it.status !== 'skipped')
            const journeys = dayItems.filter((it) => ['flight', 'train', 'bus', 'ferry', 'car', 'drive'].includes(it.kind))
            return (
              <div key={date} id={`day-${date}`} className={`card tight day-line ${date === now ? 'is-today' : ''}`}>
                <div className="day-num">
                  <small>Day</small>
                  <b>{i + 1}</b>
                </div>
                <Link to={`../today?date=${date}`} className="grow day-line-main" title="Open this day">
                  <div className="strong">
                    {[d?.city, d?.title].filter(Boolean).join(' · ') || formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}
                    {date === now && <span className="badge done" style={{ marginLeft: 6 }}>Today</span>}
                  </div>
                  <div className="small muted">
                    {formatDate(date, { weekday: 'short', day: 'numeric', month: 'short' })}
                    {' · '}
                    {dayItems.length ? `${dayItems.length} ${dayItems.length === 1 ? 'item' : 'items'}` : 'free day'}
                    {journeys.map((j) => ` · ${KIND_META[j.kind].emoji} ${j.startTime ?? ''}`.trimEnd()).join('')}
                  </div>
                </Link>
                <div className="row no-print">
                  <Link to={`../today?date=${date}`} className="btn btn-sm" aria-label={`Open day ${i + 1}`}>
                    Open ›
                  </Link>
                </div>
              </div>
            )
          })}

        {detailed && dates.map((date, i) => {
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
                  <Link to={`../favorites${d?.city ? `?city=${encodeURIComponent(d.city)}` : ''}`} className="btn btn-sm btn-ghost" title="Plan this city's sights and walks">
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
                  <ItemRow key={it.id} item={it} zoneNote={journeyNote(it, { trip, days })} onClick={() => setEditing(it)} />
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

      {wide && <div className="sticky-side stack">{map}</div>}

      {editing && <ItemEditor trip={trip} item={editing} city={dayByDate.get(editing.date)?.city} area={dayByDate.get(editing.date)} onClose={() => setEditing(null)} />}
      {dayEdit && <DayEditor day={dayEdit} onClose={() => setDayEdit(null)} />}
    </div>
  )
}

/** "These look like the same thing twice": the planned flight and the imported booking of it, for example. One tap merges them. */
function DuplicatesNotice({ tripId, items }: { tripId: string; items: Item[] }) {
  const [ignored, setIgnored] = useState(notDuplicates)
  const [open, setOpen] = useState(false)
  const groups = useMemo(() => findDuplicateGroups(items, ignored), [items, ignored])
  if (!groups.length) return null
  const merge = async (gs: DuplicateGroup[]) => {
    await mergeGroups(tripId, gs)
    toast(`Merged ${gs.length} duplicate${gs.length > 1 ? 's' : ''}`)
  }
  const notDup = (gs: DuplicateGroup[]) => {
    markNotDuplicates(gs.map((g) => g.key))
    setIgnored(notDuplicates())
  }
  return (
    <>
      <div className="notice row wrap between" style={{ alignItems: 'center' }}>
        <span>
          ⚠️ <b>{groups.length === 1 ? '1 item appears twice' : `${groups.length} items appear twice`}</b> in your plan (e.g. {groups[0].keep.title}).
        </span>
        <button className="btn-sm" onClick={() => setOpen(true)}>
          Review & merge
        </button>
      </div>
      {open && (
        <Modal title="Duplicates" onClose={() => setOpen(false)}>
          <div className="stack">
            <p className="small muted">
              Each pair is merged into one item that keeps everything known about it (booking reference, times, price). The booked version is kept first.
            </p>
            {groups.map((g) => (
              <div key={g.key} className="card tight stack" style={{ gap: 6 }}>
                <div className="small muted">{formatDate(g.keep.date)}</div>
                {[g.keep, ...g.extras].map((i, n) => (
                  <div key={i.id} className="row small">
                    <span>{KIND_META[i.kind].emoji}</span>
                    <span className="grow">
                      <b>{i.title}</b> {i.startTime && `· ${i.startTime}`} · {i.status}
                      {i.bookingRef && ` · ref ${i.bookingRef}`}
                    </span>
                    {n === 0 && <span className="badge booked">kept</span>}
                  </div>
                ))}
                <div className="row">
                  <button className="btn-sm btn-primary" onClick={() => merge([g])}>
                    Merge
                  </button>
                  <button className="btn-sm btn-ghost" onClick={() => notDup([g])}>
                    Not duplicates
                  </button>
                </div>
              </div>
            ))}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button onClick={() => setOpen(false)}>Close</button>
              <button
                className="btn-primary"
                onClick={async () => {
                  await merge(groups)
                  setOpen(false)
                }}
              >
                Merge all ({groups.length})
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

/** Quick way to say where the trip starts and finishes, so the map and the budget know. */
function StartCard({ tripId }: { tripId: string }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() {
    if (!name.trim()) return
    setBusy(true)
    const place = await locatePlace({ name: name.trim() })
    await db.trips.update(tripId, { startPlace: place })
    setBusy(false)
  }
  return (
    <div className="card tight stack" style={{ gap: 6 }}>
      <b className="small">📍 Where does the trip start (and end)?</b>
      <div className="row">
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} placeholder="e.g. San Francisco" />
        <button className="btn-primary" disabled={busy || !name.trim()} onClick={save}>
          {busy ? '…' : 'Set'}
        </button>
      </div>
      <span className="tiny muted">It's drawn on the map and used by the budget estimate. If you finish somewhere else, change it in Trip details.</span>
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
