import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import type { Day, Favorite, Place } from '../types'
import { fetchPois, interestOf, interestTier, type Interest, type Poi } from '../lib/apis'
import { cityIdeasPrompt, parseCityIdeas, type CityIdea } from '../lib/ai'
import { applyCityPlan, plannerTag, CATEGORY_META, categoryMeta, cityDates, dayCapacity, favMinutes, isIndoor, planDays, sameCity } from '../lib/favorites'
import { addDays, dateRange, daysBetween, formatDate, formatDuration, today } from '../lib/dates'
import { distance, plural } from '../lib/format'
import { haversineM, type LatLon } from '../lib/geo'
import { useAsync, useOnline } from '../lib/hooks'
import { uid } from '../lib/ids'
import { PlaceSearch } from '../components/PlaceSearch'
import { Empty, Progress, Section, Stars, toast } from '../components/ui'
import { PlaceModal, type PlaceSubject } from '../components/PlaceModal'
import LazyMap, { type MapMarker, type MapViewState } from '../components/LazyMap'
import { tripadvisorSearch } from '../lib/links'
import { PromptBox } from './IdeasPage'
import { useTripCtx } from './TripLayout'

type Source = 'sights' | 'ai' | 'own'

export default function FavoritesPage() {
  const { trip, days, items, settings } = useTripCtx()
  const [params, setParams] = useSearchParams()
  const online = useOnline()
  const favs = useLiveQuery(() => db.favorites.where('tripId').equals(trip.id).toArray(), [trip.id])

  // Cities of the trip, in order, with the first coordinates known for each.
  const cities = useMemo(() => {
    const out: { name: string; lat?: number; lon?: number }[] = []
    for (const d of days) {
      if (!d.city) continue
      const c = out.find((x) => sameCity(x.name, d.city))
      if (!c) out.push({ name: d.city, lat: d.lat, lon: d.lon })
      else if (c.lat == null && d.lat != null) Object.assign(c, { lat: d.lat, lon: d.lon })
    }
    return out
  }, [days])

  const todayCity = days.find((d) => d.date === today())?.city
  const [other, setOther] = useState<Place>()
  const city = params.get('city') ?? todayCity ?? cities[0]?.name ?? other?.name
  const cityInfo = cities.find((c) => sameCity(c.name, city)) ?? (other && sameCity(other.name, city) ? other : undefined)
  const center: LatLon | undefined = cityInfo?.lat != null && cityInfo.lon != null ? { lat: cityInfo.lat, lon: cityInfo.lon } : undefined
  const dates = city ? cityDates(days, city) : []

  const [source, setSource] = useState<Source>('sights')
  // The place open in the window: from sights, an AI idea or the wishlist itself.
  const [detail, setDetail] = useState<{ subject: PlaceSubject; poi?: Poi; idea?: CityIdea; fav?: Favorite }>()
  const [busy, setBusy] = useState(false)

  const cityFavs = (favs ?? []).filter((f) => sameCity(f.city, city))
  const findFav = (name: string, wikidata?: string) => cityFavs.find((f) => (wikidata && f.wikidata === wikidata) || f.name.toLowerCase() === name.toLowerCase())

  async function rebuild(changed: (string | undefined)[]) {
    if (!city) return
    const ds = [...new Set(changed.filter((d): d is string => !!d && dates.includes(d)))]
    if (ds.length) await applyCityPlan(trip, city, ds, settings)
  }

  async function addFav(f: Omit<Favorite, 'id' | 'tripId' | 'city' | 'addedAt'>) {
    if (!city) return
    // Checked in the database, not on screen: two quick taps on ＋ add it once.
    const already = (await db.favorites.where('tripId').equals(trip.id).toArray()).some((x) => sameCity(x.city, city) && x.name.toLowerCase() === f.name.toLowerCase())
    if (already) return
    await db.favorites.add({ ...f, id: uid(), tripId: trip.id, city, addedAt: Date.now() })
    toast(`🎯 ${f.name} added to your wishlist`)
  }

  async function removeFav(f: Favorite) {
    await db.favorites.delete(f.id)
    if (f.itemId) await db.items.delete(f.itemId)
    await rebuild([f.date])
  }

  async function toggleSight(p: Poi) {
    const existing = findFav(p.name, p.wikidata)
    if (existing) return removeFav(existing)
    await addFav({ name: p.name, lat: p.lat, lon: p.lon, category: p.category, visitMin: p.visitMin, source: 'sight', wikipedia: p.wikipedia, wikidata: p.wikidata, interest: interest.get(p.id) })
  }

  async function toggleIdea(i: CityIdea) {
    const existing = findFav(i.name)
    if (existing) return removeFav(existing)
    const cat = CATEGORY_META[i.category] ? i.category : 'attraction'
    await addFav({ name: i.name, lat: i.lat, lon: i.lon, category: cat, visitMin: i.visitMin ?? categoryMeta(cat).visitMin, indoor: i.indoor, source: 'ai', notes: i.notes })
  }

  async function move(f: Favorite, date: string | undefined) {
    await db.favorites.update(f.id, { date, pinned: !!date, itemId: undefined })
    if (f.itemId) await db.items.delete(f.itemId)
    await rebuild([f.date, date])
  }

  // Once the trip has started, only today and later days are (re)planned; past days stay as they were.
  const plannable = dates.filter((d) => d >= today())

  async function planMyDays() {
    if (!city || !plannable.length) return
    setBusy(true)
    try {
      const capacity = new Map(plannable.map((d) => [d, dayCapacity(trip, items, d)]))
      const past = cityFavs.filter((f) => f.date && f.date < today())
      const { assign } = planDays(cityFavs.filter((f) => !past.includes(f)), plannable, capacity)
      await db.favorites.bulkUpdate([...assign].map(([key, date]) => ({ key, changes: { date } })))
      await applyCityPlan(trip, city, plannable, settings)
      const backups = [...assign.values()].filter((d) => !d).length
      const used = new Set([...assign.values()].filter(Boolean)).size
      toast(`Spread over ${plural(used, 'day')}${backups ? ` · ${backups} kept as backup ideas (days are full)` : ''}`)
    } finally {
      setBusy(false)
    }
  }

  const dayNo = (d: string) => daysBetween(trip.startDate, d) + 1
  // Days of the trip with no city (for instance after stretching the trip): offered to this city.
  const unassigned = dateRange(trip.startDate, trip.endDate).filter((d) => !days.find((x) => x.date === d)?.city)
  async function assignDays() {
    if (!city) return
    for (const date of unassigned) {
      const cur = days.find((x) => x.date === date)
      await db.days.put({ ...(cur ?? { id: `${trip.id}:${date}`, tripId: trip.id, date }), city, lat: cityInfo?.lat, lon: cityInfo?.lon })
    }
    toast(`${plural(unassigned.length, 'day')} added to ${city}`)
  }
  const isScheduled = (f: Favorite) => !!f.date && (dates.includes(f.date) || !!f.itemId)
  const backups = cityFavs.filter((f) => !isScheduled(f))

  // Sights come from the part of the map you chose: the city centre at first, then wherever you pan and zoom to and tap "Search this area".
  const [searched, setSearched] = useState<{ lat: number; lon: number; radiusM: number }>()
  const [view, setView] = useState<MapViewState>()
  useEffect(() => {
    setSearched(undefined)
    setView(undefined)
  }, [city])
  const area = searched ?? (center ? { ...center, radiusM: 2500 } : undefined)
  const moved = !!(view?.user && area && (haversineM(view, area) > area.radiusM * 0.3 || view.radiusM > area.radiusM * 1.4 || view.radiusM < area.radiusM * 0.6))
  const sights = useAsync(
    () => (area && source === 'sights' ? fetchPois({ lat: area.lat, lon: area.lon }, Math.round(Math.min(25000, Math.max(500, area.radiusM)))) : Promise.resolve([] as Poi[])),
    [area?.lat, area?.lon, area?.radiusM, source],
  )
  function searchHere() {
    if (!view) return
    setSearched({ lat: view.lat, lon: view.lon, radiusM: view.radiusM })
    setSource('sights')
    setFindOpen(true)
  }

  // How interesting each sight is (Wikipedia language editions); the list can then put the best first.
  const rated = useAsync(
    () => (sights.data?.length ? interestOf(sights.data.map((p) => ({ key: p.id, wikipedia: p.wikipedia, wikidata: p.wikidata }))) : Promise.resolve(new Map<string, Interest>())),
    [sights.data],
  )
  const interest = rated.data ?? new Map<string, Interest>()

  // Wishlist entries that don't have a rating yet (older ones, or added from ideas) get one in the background.
  useEffect(() => {
    const todo = cityFavs.filter((f) => !f.interest && (f.wikipedia || f.wikidata))
    if (!todo.length) return
    let alive = true
    interestOf(todo.map((f) => ({ key: f.id, wikipedia: f.wikipedia, wikidata: f.wikidata }))).then((m) => {
      if (alive) for (const [id, i] of m) db.favorites.update(id, { interest: i })
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favs, city])

  const openPoi = (p: Poi) => setDetail({ poi: p, subject: { ...p, interest: interest.get(p.id) } })
  const openFav = (f: Favorite) =>
    setDetail({ fav: f, subject: { name: f.name, category: f.category, lat: f.lat, lon: f.lon, wikipedia: f.wikipedia, wikidata: f.wikidata, notes: f.notes, visitMin: f.visitMin, indoor: f.indoor, interest: f.interest } })
  const openIdea = (i: CityIdea) => {
    const cat = CATEGORY_META[i.category] ? i.category : 'attraction'
    setDetail({ idea: i, subject: { name: i.name, category: cat, lat: i.lat, lon: i.lon, notes: i.notes, visitMin: i.visitMin ?? categoryMeta(cat).visitMin, indoor: i.indoor } })
  }

  // One day shown on the map: its places numbered in walking order, joined by the walking route.
  const [focus, setFocus] = useState<string>()
  useEffect(() => setFocus(undefined), [city])
  const focusWalk = focus && city ? items.find((i) => i.date === focus && i.kind === 'walk' && i.planner === plannerTag(city)) : undefined
  const mapBox = useRef<HTMLDivElement>(null)
  function showOnMap(d: string) {
    setFocus(d)
    if (mapSize === 'hidden') setMapSize('small')
    setTimeout(() => mapBox.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
  }

  const markers = useMemo((): MapMarker[] => {
    const m: MapMarker[] = []
    if (source === 'sights' && !focus)
      for (const p of sights.data ?? []) {
        if (findFav(p.name, p.wikidata)) continue
        m.push({ id: p.id, lat: p.lat, lon: p.lon, label: categoryMeta(p.category).emoji, variant: 'dim', title: p.name, onClick: () => openPoi(p) })
      }
    if (focus) {
      const stops = focusWalk?.walk?.stops ?? []
      const st = focusWalk?.walk?.start
      if (st?.lat != null && st.lon != null) m.push({ id: 'start', lat: st.lat, lon: st.lon, label: 'S', variant: 'start', title: st.name })
      stops.forEach((s, n) => {
        const f = cityFavs.find((x) => x.id === s.id)
        m.push({ id: s.id, lat: s.lat, lon: s.lon, label: String(n + 1), variant: 'on', title: s.name, onClick: f ? () => openFav(f) : undefined })
      })
      return m
    }
    for (const f of cityFavs) {
      if (f.lat == null || f.lon == null) continue
      m.push({ id: f.id, lat: f.lat, lon: f.lon, label: isScheduled(f) ? String(dayNo(f.date!)) : '★', variant: isScheduled(f) ? 'on' : 'start', title: f.name, onClick: () => openFav(f) })
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sights.data, favs, source, city, focus, focusWalk])

  // Re-fit when the city, the sights or the day plan change — not on every star, which would jump while browsing.
  const fitKey = `${city}-${source}-${focus ?? ''}-${focusWalk?.walk?.distanceM ?? ''}-${cityFavs.filter((f) => f.date).map((f) => f.id + f.date).join()}`

  // What's folded: the sights/ideas search (once you have favourites), days (when there are many), the map (small by default).
  const [findOpen, setFindOpen] = useState<boolean>()
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({})
  const [backupsOpen, setBackupsOpen] = useState(true)
  const [cityOpen, setCityOpen] = useState(false)
  const [mapSize, setMapSizeState] = useState<'small' | 'large' | 'hidden'>(() => (localStorage.getItem('tm-fav-map') as 'small' | 'large' | 'hidden') || 'small')
  const setMapSize = (v: 'small' | 'large' | 'hidden') => {
    setMapSizeState(v)
    localStorage.setItem('tm-fav-map', v)
  }
  const shown = detail && (detail.fav ? cityFavs.find((f) => f.id === detail.fav!.id) : findFav(detail.subject.name, detail.subject.wikidata))
  const findIsOpen = findOpen ?? (favs !== undefined && cityFavs.length === 0)

  const cityPicker = (
    <div className="card tight stack" style={{ gap: 8 }}>
      <div className="row wrap" style={{ gap: 6 }}>
        <div className="chips grow">
          {cities.map((c) => (
            <button key={c.name} className={`chip ${sameCity(c.name, city) ? 'on' : ''}`} onClick={() => setParams({ city: c.name })}>
              {c.name}
              {(favs ?? []).filter((f) => sameCity(f.city, c.name)).length > 0 && ` 🎯${(favs ?? []).filter((f) => sameCity(f.city, c.name)).length}`}
            </button>
          ))}
          {city && !cities.some((c) => sameCity(c.name, city)) && <button className="chip on">{city}</button>}
        </div>
        <button className="btn-sm" onClick={() => setCityOpen((o) => !o)}>
          {cityOpen ? 'Hide' : '＋ Another city'}
        </button>
      </div>
      {cityOpen && (
        <PlaceSearch
          label="Search for a city"
          value={other}
          onChange={(p) => {
            setOther(p)
            if (p?.lat != null) {
              setParams({ city: p.name })
              setCityOpen(false)
            }
          }}
          placeholder="e.g. Sintra"
        />
      )}
    </div>
  )

  return (
    <div className="stack">
      {cityPicker}

      {city && unassigned.length > 0 && (
        <div className="notice info row wrap between">
          <span>
            {unassigned.length === 1 ? 'Day' : 'Days'} {unassigned.map((d) => dayNo(d)).join(', ')} {unassigned.length === 1 ? 'has' : 'have'} no city yet, so {unassigned.length === 1 ? 'it is' : 'they are'} not listed below.
          </span>
          <button className="btn-sm" onClick={assignDays}>
            Spend {unassigned.length === 1 ? 'it' : 'them'} in {city}
          </button>
        </div>
      )}

      {!city && (
        <div className="card">
          <Empty emoji="🏙️" title="Pick a city">
            Set cities on your days (Plan tab), or search for one above.
          </Empty>
        </div>
      )}

      {city && (
        <div className="grid-2">
          {/* Your favourites and days come first: that's what you come back to. */}
          <div className="stack">
            <div className="card stack">
              <div className="row between wrap">
                <h3>🗺️ {city}: wishlist & days</h3>
                <span className="small muted">{plural(cityFavs.length, 'place')}</span>
              </div>
              {dates.length > 0 ? (
                <>
                  <p className="small muted">
                    {plural(dates.length, 'day')} here ({dates.map((d) => `day ${dayNo(d)}`).join(', ')}). “Plan my days” groups your wishlist by area, fits your pace and builds a walk per day;
                    days you pick yourself are kept.
                  </p>
                  <div className="row wrap">
                    <button className="btn-primary" disabled={!cityFavs.length || busy || !plannable.length} onClick={planMyDays}>
                      {busy ? 'Planning…' : '✨ Plan my days'}
                    </button>
                    <Link className="btn btn-ghost" to="../plan">
                      See the plan →
                    </Link>
                  </div>
                </>
              ) : (
                <div className="notice info">No day of the trip is in {city} yet. Set the city on a day (Plan tab) to spread your wishlist over it — until then they're backup ideas.</div>
              )}
              {cityFavs.length === 0 && <p className="small muted">Tap ＋ on sights or ideas (below) to collect them here, or tap a place to read about it first.</p>}
            </div>

            {dates.map((d) => {
              const list = cityFavs.filter((f) => f.date === d)
              const cap = dayCapacity(trip, items, d)
              const used = list.filter((f) => !f.itemId).reduce((s, f) => s + favMinutes(f), 0)
              const open = openDays[d] ?? (d >= today() && dates.length <= 3) // past days start folded
              const status = d < today() ? 'past' : cap === 0 ? 'already full' : `${formatDuration(used * 60)} of ${formatDuration(cap * 60)} free`
              return (
                <Section
                  key={d}
                  open={open}
                  onToggle={() => setOpenDays((o) => ({ ...o, [d]: !open }))}
                  title={`Day ${dayNo(d)} · ${formatDate(d)}`}
                  summary={`· ${plural(list.length, 'place')} · ${status}`}
                >
                  <Progress value={used} max={cap || 1} over={used > cap} />
                  {list.some((f) => f.lat != null && !f.itemId) && (
                    <div>
                      <button className="btn-sm" onClick={() => showOnMap(d)}>
                        🗺️ Show this day on the map
                      </button>
                    </div>
                  )}
                  {list.some((f) => f.lat != null && !f.itemId) && (
                    <WalkSettings
                      key={d + (days.find((x) => x.date === d)?.walkStart?.name ?? '')}
                      day={days.find((x) => x.date === d)}
                      stay={items.find((i) => i.kind === 'stay' && i.date <= d && d < addDays(i.date, i.nights ?? 1) && i.location?.lat != null)?.title}
                      onSave={async (changes) => {
                        const day = days.find((x) => x.date === d)
                        if (!day) return
                        await db.days.update(day.id, changes)
                        await rebuild([d])
                      }}
                    />
                  )}
                  {list.length === 0 && <span className="small muted">Nothing from your wishlist yet.</span>}
                  {list.map((f) => (
                    <FavRow key={f.id} fav={f} dates={dates} dayNo={dayNo} onOpen={() => openFav(f)} onMove={(dt) => move(f, dt)} onRemove={() => removeFav(f)} />
                  ))}
                </Section>
              )
            })}

            {backups.length > 0 && (
              <Section open={backupsOpen} onToggle={() => setBackupsOpen((o) => !o)} title="🧺 Backup ideas" summary={`· ${backups.length} · not on a day, shown on Today when plans change`}>
                {[...backups].sort((a, b) => (b.interest?.stars ?? 0) - (a.interest?.stars ?? 0)).map((f) => (
                  <FavRow key={f.id} fav={f} dates={dates} dayNo={dayNo} onOpen={() => openFav(f)} onMove={(dt) => move(f, dt)} onRemove={() => removeFav(f)} />
                ))}
              </Section>
            )}
          </div>

          <div className="stack">
            {center && (
              <div ref={mapBox} className="card stack" style={{ gap: 8 }}>
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
                {dates.length > 0 && (
                  <div className="chips">
                    <button className={`chip ${!focus ? 'on' : ''}`} onClick={() => setFocus(undefined)}>
                      All
                    </button>
                    {dates.map((d) => (
                      <button key={d} className={`chip ${focus === d ? 'on' : ''}`} onClick={() => showOnMap(d)}>
                        Day {dayNo(d)}
                      </button>
                    ))}
                  </div>
                )}
                {focus && (
                  <div className="small stack" style={{ gap: 2 }}>
                    <b>
                      Day {dayNo(focus)} · {formatDate(focus)}
                    </b>
                    {focusWalk?.walk ? (
                      <>
                        <span className="muted">
                          🚶 {focusWalk.walk.stops.length} {focusWalk.walk.stops.length === 1 ? 'stop' : 'stops'} · {distance(focusWalk.walk.distanceM)} on foot · about{' '}
                          {formatDuration(focusWalk.walk.walkS + focusWalk.walk.stops.reduce((a, x) => a + x.visitMin, 0) * 60)} in all
                          {focusWalk.startTime && ` · starts ${focusWalk.startTime}`}
                          {focusWalk.walk.routedBy === 'straight-line' && ' · straight-line estimate'}
                        </span>
                        <ol style={{ margin: 0, paddingLeft: 20 }}>
                          {focusWalk.walk.stops.map((x) => (
                            <li key={x.id}>
                              {x.name} <span className="tiny muted">~{formatDuration(x.visitMin * 60)}</span>
                            </li>
                          ))}
                        </ol>
                      </>
                    ) : (
                      <span className="muted">Nothing with a location on this day yet. Add places from the wishlist, then “Plan my days”.</span>
                    )}
                  </div>
                )}
                {mapSize !== 'hidden' && !focus && (
                  <div className="row wrap" style={{ gap: 6 }}>
                    {moved ? (
                      <button className="btn-primary btn-sm" onClick={searchHere}>
                        🔎 Search this area
                      </button>
                    ) : (
                      <span className="tiny muted">{searched ? 'Sights shown are from the area you searched.' : 'Move or zoom the map, then tap “Search this area” to find sights there.'}</span>
                    )}
                    {searched && (
                      <button className="btn-sm" onClick={() => setSearched(undefined)}>
                        ↩ Back to the city centre
                      </button>
                    )}
                  </div>
                )}
                {mapSize !== 'hidden' && <LazyMap key={mapSize} markers={markers} line={focusWalk?.walk?.geometry} dashed={focusWalk?.walk?.routedBy === 'straight-line'} center={center} zoom={13} fitKey={fitKey} className={mapSize === 'large' ? 'tall' : 'short'} locate onMoveEnd={setView} />}
              </div>
            )}

            <Section open={findIsOpen} onToggle={() => setFindOpen(!findIsOpen)} title="🔎 Find things to do" summary={findIsOpen ? undefined : '· sights, AI ideas, add your own'}>
              <div className="chips">
                <button className={`chip ${source === 'sights' ? 'on' : ''}`} onClick={() => setSource('sights')}>
                  🏛️ Sights
                </button>
                <button className={`chip ${source === 'ai' ? 'on' : ''}`} onClick={() => setSource('ai')}>
                  ✨ AI ideas
                </button>
                <button className={`chip ${source === 'own' ? 'on' : ''}`} onClick={() => setSource('own')}>
                  ✏️ Add your own
                </button>
              </div>
              {source === 'sights' && (
                <SightList
                  city={city}
                  pois={sights.data}
                  loading={sights.loading}
                  error={sights.error ? (online ? 'The free sights services are busy — try again in a minute.' : 'You are offline — sights load when you are back online.') : undefined}
                  noCenter={!center}
                  isFav={(p) => !!findFav(p.name, p.wikidata)}
                  onToggle={toggleSight}
                  onOpen={openPoi}
                  center={area}
                  interest={interest}
                  rating={rated.loading}
                />
              )}
              {source === 'ai' && (
                <AiIdeas
                  city={city}
                  isFav={(i) => !!findFav(i.name)}
                  onToggle={toggleIdea}
                  onOpen={openIdea}
                />
              )}
              {source === 'own' && <OwnIdea city={city} onAdd={addFav} />}
            </Section>
          </div>
        </div>
      )}

      {detail && city && (
        <PlaceModal
          subject={shown ? { ...detail.subject, interest: detail.subject.interest ?? shown.interest } : detail.subject}
          city={city}
          inList={!!shown}
          onToggle={async () => {
            if (detail.poi) await toggleSight(detail.poi)
            else if (detail.idea) await toggleIdea(detail.idea)
            else if (shown) {
              await removeFav(shown)
              setDetail(undefined)
            }
          }}
          onClose={() => setDetail(undefined)}
          onInterest={(i) => {
            if (shown && !shown.interest) db.favorites.update(shown.id, { interest: i })
          }}
          dayPicker={
            shown &&
            dates.length > 0 && (
              <select className="btn-sm" style={{ width: 'auto', minHeight: 36 }} value={shown.date && dates.includes(shown.date) ? shown.date : ''} onChange={(e) => move(shown, e.target.value || undefined)} aria-label="Day">
                <option value="">Backup (no day)</option>
                {dates.map((d) => (
                  <option key={d} value={d}>
                    Day {dayNo(d)} · {formatDate(d)}
                  </option>
                ))}
              </select>
            )
          }
        />
      )}
    </div>
  )
}

/** How the day's walking tour is built: where and when it starts, and whether it ends back at the start. Changing one rebuilds the walk. */
function WalkSettings({ day, stay, onSave }: { day?: Day; stay?: string; onSave: (changes: Partial<Day>) => void }) {
  const [place, setPlace] = useState<Place | undefined>(day?.walkStart)
  const from = day?.walkStart?.name ?? stay ?? `${day?.city ?? 'city'} centre`
  return (
    <details className="card tight">
      <summary className="small strong" style={{ cursor: 'pointer' }}>
        🚶 Walk · {day?.walkStartTime ? `starts ${day.walkStartTime}` : 'starts after what is already planned'} · from {from}
        {day?.walkRoundTrip ? ' · back to the start' : ''}
      </summary>
      <div className="stack" style={{ marginTop: 8, gap: 8 }}>
        <div className="form-grid">
          <label>
            Start time
            <input type="time" defaultValue={day?.walkStartTime ?? ''} onBlur={(e) => e.target.value !== (day?.walkStartTime ?? '') && onSave({ walkStartTime: e.target.value || undefined })} />
          </label>
          <label className="inline" style={{ alignSelf: 'end' }}>
            <input type="checkbox" checked={!!day?.walkRoundTrip} onChange={(e) => onSave({ walkRoundTrip: e.target.checked || undefined })} /> End back at the start
          </label>
        </div>
        <PlaceSearch
          label="Start from"
          value={place}
          onChange={(p) => {
            setPlace(p)
            if (p?.lat != null) onSave({ walkStart: p })
          }}
          placeholder={`Default: ${stay ?? 'the city centre'}. Type a hotel or station, then Find`}
        />
        <div className="row wrap">
          {day?.walkStart && (
            <button
              className="btn-sm"
              onClick={() => {
                setPlace(undefined)
                onSave({ walkStart: undefined })
              }}
            >
              ↩ Start from {stay ?? 'the city centre'}
            </button>
          )}
          {day?.walkStartTime && (
            <button className="btn-sm" onClick={() => onSave({ walkStartTime: undefined })}>
              ↩ Start time automatic
            </button>
          )}
        </div>
      </div>
    </details>
  )
}

/** 🦉 opens Tripadvisor's search for this place: reviews, photos and opening hours, outside the app. */
function TripadvisorLink({ name, city }: { name: string; city: string }) {
  return (
    <a
      className="btn btn-ghost btn-sm"
      style={{ padding: '0 6px', minHeight: 28 }}
      href={tripadvisorSearch(name, city)}
      target="_blank"
      rel="noreferrer"
      title="Find on Tripadvisor"
      aria-label={`Find ${name} on Tripadvisor`}
      onClick={(e) => e.stopPropagation()}
    >
      🦉
    </a>
  )
}

function FavRow({ fav: f, dates, dayNo, onOpen, onMove, onRemove }: { fav: Favorite; dates: string[]; dayNo: (d: string) => number; onOpen: () => void; onMove: (d: string | undefined) => void; onRemove: () => void }) {
  const meta = categoryMeta(f.category)
  return (
    <div className="row" style={{ alignItems: 'center' }}>
      <span style={{ fontSize: '1.2rem' }}>{meta.emoji}</span>
      <div className="grow" style={{ cursor: 'pointer' }} onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
        <div className="small strong">
          {f.name} {f.interest && <Stars value={f.interest.stars} title={interestTier(f.interest.stars)} />}
        </div>
        <div className="tiny muted">
          ~{formatDuration(f.visitMin * 60)}
          {isIndoor(f) && ' · indoor'}
          {f.lat == null && ' · no location'}
          {f.pinned && ' · 📌 your choice'}
          {f.itemId && ' · added on the day'}
          {f.notes && ` · ${f.notes}`}
        </div>
      </div>
      <TripadvisorLink name={f.name} city={f.city} />
      <select className="btn-sm" style={{ width: 'auto', minHeight: 30, padding: '2px 6px' }} value={f.date && dates.includes(f.date) ? f.date : ''} onChange={(e) => onMove(e.target.value || undefined)} aria-label="Day">
        <option value="">Backup</option>
        {dates.map((d) => (
          <option key={d} value={d}>
            Day {dayNo(d)}
          </option>
        ))}
      </select>
      <button className="icon-btn" onClick={onRemove} aria-label="Remove">
        ✕
      </button>
    </div>
  )
}

function SightList(p: {
  city: string
  pois?: Poi[]
  loading: boolean
  error?: string
  noCenter: boolean
  center?: LatLon
  isFav: (p: Poi) => boolean
  onToggle: (p: Poi) => void
  onOpen: (p: Poi) => void
  interest: Map<string, Interest>
  rating: boolean
}) {
  const [cat, setCat] = useState<string>()
  const [sort, setSort] = useState<'interest' | 'near'>('interest')
  if (p.noCenter) return <p className="small muted">This city has no coordinates yet — tap “Find” on the day's city (Plan tab) or search above.</p>
  const stars = (x: Poi) => p.interest.get(x.id)?.stars ?? 0
  const list = (p.pois ?? [])
    .filter((x) => !cat || x.category === cat)
    .sort((a, b) => (sort === 'near' && p.center ? haversineM(p.center, a) - haversineM(p.center, b) : stars(b) - stars(a) || b.score - a.score))
  const cats = [...new Set((p.pois ?? []).map((x) => x.category))]
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="chips">
        <button className={`chip ${sort === 'interest' ? 'on' : ''}`} onClick={() => setSort('interest')}>
          ★ Most interesting first
        </button>
        <button className={`chip ${sort === 'near' ? 'on' : ''}`} onClick={() => setSort('near')}>
          📍 Nearest first
        </button>
      </div>
      {cats.length > 1 && (
        <div className="chips">
          <button className={`chip ${!cat ? 'on' : ''}`} onClick={() => setCat(undefined)}>
            All
          </button>
          {cats.map((c) => (
            <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>
              {categoryMeta(c).emoji} {categoryMeta(c).label}
            </button>
          ))}
        </div>
      )}
      {p.loading && <p className="small muted">Loading sights…</p>}
      {!p.loading && p.rating && <p className="tiny muted">Rating how well known each place is…</p>}
      {!p.loading && !p.rating && p.interest.size > 0 && <p className="tiny muted">Stars show how widely a place is written about on Wikipedia, not visitor reviews.</p>}
      {p.error && <div className="notice error">{p.error}</div>}
      <div className="poi-list">
        {list.map((x) => (
          <div key={x.id} className={`poi ${p.isFav(x) ? 'on' : ''}`} onClick={() => p.onOpen(x)}>
            <span style={{ fontSize: '1.3rem' }}>{categoryMeta(x.category).emoji}</span>
            <div className="grow">
              <div className="strong small">
                {x.name} {p.interest.get(x.id) && <Stars value={p.interest.get(x.id)!.stars} title={interestTier(p.interest.get(x.id)!.stars)} />}
              </div>
              <div className="tiny muted">
                {categoryMeta(x.category).label}
                {p.center && ` · ${distance(haversineM(p.center, x))} from centre`} · ~{x.visitMin} min
              </div>
            </div>
            <TripadvisorLink name={x.name} city={p.city} />
            <button
              className={`btn-sm ${p.isFav(x) ? 'btn-primary' : ''}`}
              aria-label="Add to wishlist"
              onClick={(e) => {
                e.stopPropagation()
                p.onToggle(x)
              }}
            >
              {p.isFav(x) ? '✓' : '＋'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function AiIdeas({ city, isFav, onToggle, onOpen }: { city: string; isFav: (i: CityIdea) => boolean; onToggle: (i: CityIdea) => void; onOpen: (i: CityIdea) => void }) {
  const { trip, settings } = useTripCtx()
  const key = `tm-cityideas:${trip.id}:${city.toLowerCase()}`
  const [answer, setAnswer] = useState(() => localStorage.getItem(key) ?? '')
  const parsed = useMemo(() => {
    if (!answer.trim()) return {}
    try {
      return { ideas: parseCityIdeas(answer) }
    } catch (e) {
      return { error: (e as Error).message }
    }
  }, [answer])
  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="small muted">Restaurants, experiences, day trips and kid-friendly places that map data misses. Copy the prompt into a free chatbot and paste its answer.</p>
      <PromptBox
        prompt={cityIdeasPrompt(trip, settings, city)}
        onAnswer={(t) => {
          setAnswer(t)
          localStorage.setItem(key, t)
        }}
      />
      <textarea
        className="code"
        style={{ minHeight: 80 }}
        value={answer}
        placeholder='{"ideas": [ … ]}'
        onChange={(e) => {
          setAnswer(e.target.value)
          localStorage.setItem(key, e.target.value)
        }}
      />
      {parsed.error && <div className="notice error">{parsed.error}</div>}
      <div className="poi-list">
        {parsed.ideas?.map((i) => (
          <div key={i.name} className={`poi ${isFav(i) ? 'on' : ''}`} onClick={() => onOpen(i)}>
            <span style={{ fontSize: '1.3rem' }}>{categoryMeta(i.category).emoji}</span>
            <div className="grow">
              <div className="strong small">{i.name}</div>
              <div className="tiny muted">
                {categoryMeta(i.category).label}
                {i.visitMin && ` · ~${formatDuration(i.visitMin * 60)}`}
                {i.indoor && ' · indoor'}
                {i.notes && ` · ${i.notes}`}
              </div>
            </div>
            <TripadvisorLink name={i.name} city={city} />
            <button
              className={`btn-sm ${isFav(i) ? 'btn-primary' : ''}`}
              aria-label="Add to wishlist"
              onClick={(e) => {
                e.stopPropagation()
                onToggle(i)
              }}
            >
              {isFav(i) ? '✓' : '＋'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function OwnIdea({ city, onAdd }: { city: string; onAdd: (f: Omit<Favorite, 'id' | 'tripId' | 'city' | 'addedAt'>) => Promise<void> }) {
  const [place, setPlace] = useState<Place>()
  const [category, setCategory] = useState('attraction')
  const [minutes, setMinutes] = useState(60)
  const [indoor, setIndoor] = useState(false)
  const [notes, setNotes] = useState('')
  async function add() {
    if (!place?.name) return
    await onAdd({ name: place.name, lat: place.lat, lon: place.lon, category, visitMin: minutes, indoor, source: 'manual', notes: notes || undefined })
    setPlace(undefined)
    setNotes('')
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <PlaceSearch label="Place or idea" value={place} onChange={setPlace} near={city} placeholder="e.g. the bakery my friend recommended" />
      <div className="form-grid">
        <label>
          Type
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {Object.entries(CATEGORY_META).map(([k, c]) => (
              <option key={k} value={k}>
                {c.emoji} {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Time there
          <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {[15, 30, 45, 60, 90, 120, 180, 240, 420].map((m) => (
              <option key={m} value={m}>
                {formatDuration(m * 60)}
              </option>
            ))}
          </select>
        </label>
        <label className="inline" style={{ alignSelf: 'end' }}>
          <input type="checkbox" checked={indoor} onChange={(e) => setIndoor(e.target.checked)} /> Indoor
        </label>
        <label className="full">
          Notes
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      <p className="tiny muted">Tap “Find” to attach a location so it can join a walking tour.</p>
      <div>
        <button className="btn-primary" disabled={!place?.name} onClick={add}>
          🎯 Add to wishlist
        </button>
      </div>
    </div>
  )
}
