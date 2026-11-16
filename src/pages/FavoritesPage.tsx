import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import type { Day, Favorite, GetAround, Item, Place } from '../types'
import { fetchPois, interestOf, interestTier, type Interest, type Poi } from '../lib/apis'
import { cityIdeasPrompt, parseCityIdeas, type CityIdea } from '../lib/ai'
import { askCityIdeas, cityIdeasStatus, cityIdeasText, setCityIdeasText, useCityIdeasVersion } from '../lib/cityideas'
import { KIND_META } from '../components/kinds'
import { isHome } from '../lib/home'
import { ItemEditor } from '../components/ItemEditor'
import { applyCityPlan, linkWishlistToPlan, sendToBackup, CATEGORY_META, categoryMeta, cityDates, dayCapacity, favMinutes, fillUntimed, isIndoor, planDays, sameCity } from '../lib/favorites'
import { addDays, dateRange, daysBetween, formatDate, formatDuration, hhmmToMin, today } from '../lib/dates'
import { distance, plural } from '../lib/format'
import { haversineM, type LatLon } from '../lib/geo'
import { useAsync, useMapSize, useOnline } from '../lib/hooks'
import { uid } from '../lib/ids'
import { PlaceSearch } from '../components/PlaceSearch'
import { Empty, Progress, Section, Stars, toast } from '../components/ui'
import { PlaceModal, type PlaceSubject } from '../components/PlaceModal'
import { matchesPlace } from '../lib/duplicates'
import { useDayRoute } from '../lib/dayroute'
import { OptimiseDayButton } from '../components/OptimiseDay'
import { GET_AROUND_LABEL, legText } from '../lib/legs'
import LazyMap, { type MapMarker, type MapViewState } from '../components/LazyMap'
import { tripadvisorSearch } from '../lib/links'
import { AnswerBox, PromptBox, useAiWords } from './IdeasPage'
import { useTripCtx } from './TripLayout'

/** One thing on a day: a plan item (the itinerary's, yours, or one the City planner made from the wishlist), a wishlist place, or both. */
interface Entry {
  key: string
  item?: Item
  fav?: Favorite
}

/** How long something on a day takes, in minutes: its own times, the wishlist place's visit, or a default for its kind. */
function entryMinutes(e: Entry): number {
  const it = e.item
  if (it?.startTime && it.endTime) {
    const m = hhmmToMin(it.endTime) - hhmmToMin(it.startTime)
    if (m > 0) return m
  }
  if (e.fav) return favMinutes(e.fav)
  return it?.kind === 'meal' ? 60 : 90
}

export default function FavoritesPage() {
  const { trip, days, items, settings } = useTripCtx()
  const [params, setParams] = useSearchParams()
  const online = useOnline()
  const favs = useLiveQuery(() => db.favorites.where('tripId').equals(trip.id).toArray(), [trip.id])

  // Cities of the trip, in order, with the first coordinates known for each.
  const cities = useMemo(() => {
    const out: { name: string; lat?: number; lon?: number }[] = []
    // Home (where the trip starts and ends) isn't one of the trip's cities, unless the whole trip is there.
    const away = days.some((d) => d.city && !isHome(trip, { name: d.city, lat: d.lat, lon: d.lon }))
    for (const d of days) {
      if (!d.city || (away && isHome(trip, { name: d.city, lat: d.lat, lon: d.lon }))) continue
      const c = out.find((x) => sameCity(x.name, d.city))
      if (!c) out.push({ name: d.city, lat: d.lat, lon: d.lon })
      else if (c.lat == null && d.lat != null) Object.assign(c, { lat: d.lat, lon: d.lon })
    }
    return out
  }, [days, trip.startPlace, trip.endPlace])

  const todayCity = cities.find((c) => sameCity(c.name, days.find((d) => d.date === today())?.city))?.name // not home on the day you leave
  const [other, setOther] = useState<Place>()
  const city = params.get('city') ?? todayCity ?? cities[0]?.name ?? other?.name
  const cityInfo = cities.find((c) => sameCity(c.name, city)) ?? (other && sameCity(other.name, city) ? other : undefined)
  const center: LatLon | undefined = cityInfo?.lat != null && cityInfo.lon != null ? { lat: cityInfo.lat, lon: cityInfo.lon } : undefined
  const dates = city ? cityDates(days, city) : []

  // The place open in the window: from sights, an AI idea or the wishlist itself.
  const [detail, setDetail] = useState<{
    subject: PlaceSubject
    poi?: Poi
    idea?: CityIdea
    fav?: Favorite
  }>()
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
    // Already in your plan (say the itinerary has "Visit the castle")? Link it instead of planning it twice.
    const match = items.find((i) => !i.planner && dates.includes(i.date) && matchesPlace(i, f))
    await db.favorites.add({
      ...f,
      id: uid(),
      tripId: trip.id,
      city,
      addedAt: Date.now(),
      ...(match ? { date: match.date, itemId: match.id, pinned: true } : {}),
    })
    toast(match ? `🎯 ${f.name} is already in your plan on day ${daysBetween(trip.startDate, match.date) + 1}: linked` : `🧺 ${f.name} added to the backup ideas · “Plan my days” puts it on a day`)
  }

  async function removeFav(f: Favorite) {
    const linked = f.itemId ? await db.items.get(f.itemId) : undefined
    await db.favorites.delete(f.id)
    if (linked?.favId === f.id) await db.items.delete(linked.id) // only what the wishlist created; items of your own plan stay
    await rebuild([f.date])
  }

  async function toggleSight(p: Poi) {
    const existing = findFav(p.name, p.wikidata)
    if (existing) return removeFav(existing)
    await addFav({ name: p.name, lat: p.lat, lon: p.lon, category: p.category, visitMin: p.visitMin, source: 'sight', wikipedia: p.wikipedia, wikidata: p.wikidata, interest: interest.get(p.id), openingHours: p.openingHours })
  }

  async function toggleIdea(i: CityIdea) {
    const existing = findFav(i.name)
    if (existing) return removeFav(existing)
    const cat = CATEGORY_META[i.category] ? i.category : 'attraction'
    await addFav({
      name: i.name,
      lat: i.lat,
      lon: i.lon,
      category: cat,
      visitMin: i.visitMin ?? categoryMeta(cat).visitMin,
      indoor: i.indoor,
      source: 'ai',
      notes: i.notes,
    })
  }

  async function move(f: Favorite, date: string | undefined) {
    const linked = f.itemId ? await db.items.get(f.itemId) : undefined
    if (linked && date) {
      // Linked to a plan item: the item moves with it, and gets a time on its new day (unless it's booked or 📌).
      const keep = linked.status === 'booked' || linked.locked
      await db.items.update(
        linked.id,
        keep
          ? { date }
          : {
              date,
              startTime: undefined,
              endTime: undefined,
              legIn: undefined,
            },
      )
      await db.favorites.update(f.id, { date, pinned: true })
      await rebuild([f.date, date])
      if (!keep) await fillUntimed(trip.id, date, settings)
      return
    }
    if (linked?.favId === f.id) await db.items.delete(linked.id)
    await db.favorites.update(f.id, {
      date,
      pinned: !!date,
      itemId: undefined,
    })
    await rebuild([f.date, date])
  }

  const booked = (it?: Item) => !!it && (it.status === 'booked' || !!it.locked)
  const entryName = (e: Entry) => e.fav?.name ?? e.item?.title ?? ''

  /** Anything on a day goes to the backup ideas: a wishlist place loses its day; a plan item becomes a backup idea. */
  async function entryToBackup(e: Entry) {
    const it = e.item
    if (booked(it) && !confirm(`“${it!.title}” is ${it!.status === 'booked' ? 'booked' : 'pinned 📌'} on this day. Move it to the backup ideas anyway?`)) return
    if (e.fav) {
      if (it) await db.items.delete(it.id)
      await db.favorites.update(e.fav.id, {
        date: undefined,
        pinned: false,
        itemId: undefined,
      })
    } else if (it) await sendToBackup(it)
    await rebuild([it?.date ?? e.fav?.date])
    toast(`🧺 ${entryName(e)} is now a backup idea`)
  }

  /** To another day: it gets a time there around what's already planned (a booked or 📌 item keeps its time). */
  async function entryToDay(e: Entry, date: string) {
    if (e.fav) return move(e.fav, date)
    const it = e.item
    if (!it) return
    await db.items.update(
      it.id,
      booked(it)
        ? { date }
        : {
            date,
            startTime: undefined,
            endTime: undefined,
            autoTime: undefined,
            legIn: undefined,
          },
    )
    await rebuild([it.date, date])
    if (!booked(it)) await fillUntimed(trip.id, date, settings)
    toast(`${entryName(e)} moved to day ${dayNo(date)}`)
  }

  async function entryRemove(e: Entry) {
    const it = e.item
    if (!confirm(`Remove “${entryName(e)}” from the trip?${booked(it) ? ' It is booked or pinned.' : ''}`)) return
    if (e.fav) await db.favorites.delete(e.fav.id)
    if (it) await db.items.delete(it.id)
    await rebuild([it?.date ?? e.fav?.date])
  }

  // Once the trip has started, only today and later days are (re)planned; past days stay as they were.
  const plannable = dates.filter((d) => d >= today())

  async function planMyDays() {
    if (!city || !plannable.length) return
    setBusy(true)
    try {
      // First, places the plan already has are tied to those items (and their days), so they are timed there, not added again.
      await linkWishlistToPlan(trip.id, city)
      const fresh = (await db.favorites.where('tripId').equals(trip.id).toArray()).filter((f) => sameCity(f.city, city))
      const capacity = new Map(plannable.map((d) => [d, dayCapacity(trip, items, d)]))
      const past = fresh.filter((f) => f.date && f.date < today())
      const { assign } = planDays(fresh.filter((f) => !past.includes(f)), plannable, capacity)
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
  // What the days already hold: activities, meals and walks on the plan (yours, the itinerary's and the wishlist's).
  const placesIn = (ds: string[]) => items.filter((i) => ds.includes(i.date) && ['activity', 'meal', 'walk'].includes(i.kind) && i.status !== 'skipped')
  /** "Day 3" when this place is already on one of the city's days (as a wishlist place or a plan item), else nothing. */
  const inPlan = (p: { name: string; lat?: number; lon?: number; wikidata?: string }) => {
    const fav = findFav(p.name, p.wikidata)
    if (fav?.date && dates.includes(fav.date)) return `Day ${dayNo(fav.date)}`
    const it = placesIn(dates).find((i) => matchesPlace(i, p))
    return it ? `Day ${dayNo(it.date)}` : undefined
  }
  // Days of the trip with no city (for instance after stretching the trip): offered to this city.
  const unassigned = dateRange(trip.startDate, trip.endDate).filter((d) => !days.find((x) => x.date === d)?.city)
  async function assignDays() {
    if (!city) return
    for (const date of unassigned) {
      const cur = days.find((x) => x.date === date)
      await db.days.put({
        ...(cur ?? { id: `${trip.id}:${date}`, tripId: trip.id, date }),
        city,
        lat: cityInfo?.lat,
        lon: cityInfo?.lon,
      })
    }
    toast(`${plural(unassigned.length, 'day')} added to ${city}`)
  }
  /** Everything on a day, in time order: plan items (with their wishlist place, when they have one) and wishlist places not yet planned. */
  const entriesOn = (d: string): Entry[] => {
    const its = items.filter((i) => i.date === d && ['activity', 'meal', 'walk'].includes(i.kind) && i.status !== 'skipped')
    const linkedFav = (i: Item) => cityFavs.find((f) => f.id === i.favId || f.itemId === i.id)
    const out: Entry[] = its.map((i) => ({
      key: i.id,
      item: i,
      fav: linkedFav(i),
    }))
    for (const f of cityFavs) if (f.date === d && !out.some((e) => e.fav?.id === f.id)) out.push({ key: f.id, fav: f })
    return out.sort((a, b) => (a.item?.startTime ?? '99').localeCompare(b.item?.startTime ?? '99'))
  }
  const [editing, setEditing] = useState<Item>()
  const isScheduled = (f: Favorite) => !!f.date && dates.includes(f.date)
  const backups = cityFavs.filter((f) => !isScheduled(f))

  // Sights come from the part of the map you look at: the city centre at first, then wherever you pan and zoom to.
  const [searched, setSearched] = useState<{
    lat: number
    lon: number
    radiusM: number
  }>()
  const [view, setView] = useState<MapViewState>()
  useEffect(() => {
    setSearched(undefined)
    setView(undefined)
  }, [city])
  const area = searched ?? (center ? { ...center, radiusM: 2500 } : undefined)
  const moved = !!(view?.user && area && (haversineM(view, area) > area.radiusM * 0.3 || view.radiusM > area.radiusM * 1.4 || view.radiusM < area.radiusM * 0.6))
  const sights = useAsync(
    () => (area ? fetchPois({ lat: area.lat, lon: area.lon }, Math.round(Math.min(25000, Math.max(500, area.radiusM)))) : Promise.resolve([] as Poi[])),
    [area?.lat, area?.lon, area?.radiusM],
  )
  // Once you stop moving the map (a second later, so a pan isn't a dozen searches), the sights follow what's on screen.
  useEffect(() => {
    if (!moved || !view) return
    const t = setTimeout(() => setSearched({ lat: view.lat, lon: view.lon, radiusM: view.radiusM }), 1000)
    return () => clearTimeout(t)
  }, [moved, view?.lat, view?.lon, view?.radiusM]) // eslint-disable-line react-hooks/exhaustive-deps

  // How interesting each sight is (Wikipedia language editions); the list can then put the best first.
  const rated = useAsync(
    () =>
      sights.data?.length
        ? interestOf(
            sights.data.map((p) => ({
              key: p.id,
              wikipedia: p.wikipedia,
              wikidata: p.wikidata,
            })),
          )
        : Promise.resolve(new Map<string, Interest>()),
    [sights.data],
  )
  const interest = rated.data ?? new Map<string, Interest>()

  // ChatGPT's ideas for the city: asked for when the itinerary was chosen, or now, the first time the city is opened.
  useCityIdeasVersion()
  const api = useAiWords()
  const ideasText = city ? cityIdeasText(trip.id, city) : ''
  const ideasStatus = city ? cityIdeasStatus(trip.id, city) : undefined
  const ideasRead = useMemo(() => {
    if (!ideasText.trim()) return { ideas: [] as CityIdea[] }
    try {
      return { ideas: parseCityIdeas(ideasText) }
    } catch (e) {
      return { ideas: [] as CityIdea[], error: (e as Error).message }
    }
  }, [ideasText])
  const askedFor = useRef(new Set<string>())
  useEffect(() => {
    if (!api || !city || ideasText.trim() || ideasStatus || askedFor.current.has(city)) return
    askedFor.current.add(city)
    void askCityIdeas(trip.id, city, settings)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, city, ideasText, ideasStatus])

  // Wishlist entries that don't have a rating yet (older ones, or added from ideas) get one in the background.
  useEffect(() => {
    const todo = cityFavs.filter((f) => !f.interest && (f.wikipedia || f.wikidata))
    if (!todo.length) return
    let alive = true
    interestOf(
      todo.map((f) => ({
        key: f.id,
        wikipedia: f.wikipedia,
        wikidata: f.wikidata,
      })),
    ).then((m) => {
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
    setDetail({
      idea: i,
      subject: {
        name: i.name,
        category: cat,
        lat: i.lat,
        lon: i.lon,
        notes: i.notes,
        visitMin: i.visitMin ?? categoryMeta(cat).visitMin,
        indoor: i.indoor,
      },
    })
  }

  // One day shown on the map: its places numbered in walking order, joined by the walking route.
  const [focus, setFocus] = useState<string | undefined>(params.get('day') ?? undefined)
  useEffect(() => setFocus(params.get('day') ?? undefined), [city])
  // Everything with a place on that day, planned here or added by hand, in time order: the same path as on Day by day.
  const { route: focusRoute, stops: focusItems } = useDayRoute(items, focus ?? '', days.find((x) => x.date === focus), settings, { trip, days })
  const focusSegments = focusRoute?.segments ?? []
  const focusStart = focusRoute?.start
  const mapBox = useRef<HTMLDivElement>(null)
  function showOnMap(d: string) {
    setFocus(d)
    if (mapSize === 'hidden') setMapSize('small')
    setTimeout(() => mapBox.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
  }

  const markers = useMemo((): MapMarker[] => {
    const m: MapMarker[] = []
    if (!focus) {
      for (const p of sights.data ?? []) {
        if (findFav(p.name, p.wikidata)) continue
        m.push({
          id: p.id,
          lat: p.lat,
          lon: p.lon,
          label: categoryMeta(p.category).emoji,
          variant: 'dim',
          title: p.name,
          onClick: () => openPoi(p),
        })
      }
      for (const i of ideasRead.ideas) {
        if (i.lat == null || i.lon == null || findFav(i.name)) continue
        m.push({
          id: `idea:${i.name}`,
          lat: i.lat,
          lon: i.lon,
          label: categoryMeta(i.category).emoji,
          variant: 'dim',
          title: `✨ ${i.name}`,
          onClick: () => openIdea(i),
        })
      }
    }
    if (focus) {
      if (focusStart)
        m.push({
          id: 'start',
          lat: focusStart.lat,
          lon: focusStart.lon,
          label: 'S',
          variant: 'start',
          title: focusStart.name ?? 'Start',
        })
      // Tonight's hotel, when it isn't where the day started (a moving day).
      const end = focusRoute?.end
      if (end && !(focusStart && Math.abs(focusStart.lat - end.lat) < 1e-3 && Math.abs(focusStart.lon - end.lon) < 1e-3)) m.push({ id: 'end', lat: end.lat, lon: end.lon, label: '🏨', variant: 'start', title: `Tonight: ${end.name}` })
      focusRoute?.stops.forEach(({ item: it, at }, n) => {
        const f = cityFavs.find((x) => x.id === it.favId || x.itemId === it.id)
        m.push({
          id: it.id,
          lat: at.lat,
          lon: at.lon,
          label: String(n + 1),
          variant: 'on',
          title: it.title,
          onClick: f ? () => openFav(f) : undefined,
        })
      })
      return m
    }
    for (const f of cityFavs) {
      if (f.lat == null || f.lon == null) continue
      m.push({
        id: f.id,
        lat: f.lat,
        lon: f.lon,
        label: isScheduled(f) ? String(dayNo(f.date!)) : '★',
        variant: isScheduled(f) ? 'on' : 'start',
        title: f.name,
        onClick: () => openFav(f),
      })
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sights.data, ideasRead, favs, city, focus, focusRoute, focusStart])

  // Re-fit when the city, the sights or the day plan change — not on every star, which would jump while browsing.
  const fitKey = `${city}-${focus ?? ''}-${focusItems.map((i) => i.id).join()}-${cityFavs
    .filter((f) => f.date)
    .map((f) => f.id + f.date)
    .join()}`

  // What's folded: the sights/ideas search (once you have favourites), days (when there are many), the map (small by default).
  const [findOpen, setFindOpen] = useState<boolean>()
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({})
  const [backupsOpen, setBackupsOpen] = useState(true)
  const [cityOpen, setCityOpen] = useState(false)
  const [mapSize, setMapSize] = useMapSize('tm-fav-map', settings.mapSize)
  const shown = detail && (detail.fav ? cityFavs.find((f) => f.id === detail.fav!.id) : findFav(detail.subject.name, detail.subject.wikidata))
  const findIsOpen = findOpen ?? (favs !== undefined && cityFavs.length === 0)

  /** Everything planned on a city's days, as its day sections count it: plan items, and wishlist places not planned yet. */
  const activityCount = (name: string) => {
    const ds = new Set(cityDates(days, name))
    const its = items.filter((i) => ds.has(i.date) && ['activity', 'meal', 'walk'].includes(i.kind) && i.status !== 'skipped')
    const waiting = (favs ?? []).filter((f) => sameCity(f.city, name) && f.date && ds.has(f.date) && !its.some((i) => i.favId === f.id || i.id === f.itemId))
    return its.length + waiting.length
  }

  const cityPicker = (
    <div className="card tight stack" style={{ gap: 8 }}>
      <div className="row wrap" style={{ gap: 6 }}>
        <div className="chips grow">
          {cities.map((c) => (
            <button key={c.name} className={`chip ${sameCity(c.name, city) ? 'on' : ''}`} onClick={() => setParams({ city: c.name })} title={`${plural(activityCount(c.name), 'activity', 'activities')} planned`}>
              {c.name}
              {activityCount(c.name) > 0 && ` · ${activityCount(c.name)}`}
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
                <h3>🗺️ {city}: your days</h3>
                <span className="small muted">
                  {plural(
                    dates.reduce((n, d) => n + entriesOn(d).length, 0),
                    'activity',
                    'activities',
                  )}{' '}
                  over {plural(dates.length, 'day')} · {plural(backups.length, 'backup idea')}
                </span>
              </div>
              {dates.length > 0 ? (
                <>
                  <p className="small muted">
                    Each day lists everything planned there. Move anything to another day or to the backup ideas with its menu. “Plan my days” spreads the backup ideas and new places over the days, by
                    area and your pace, and gives everything a time; days you pick yourself are kept.
                  </p>
                  <div className="row wrap">
                    <button className="btn-primary" disabled={busy || !plannable.length} onClick={planMyDays}>
                      {busy ? 'Planning…' : '✨ Plan my days'}
                    </button>
                    <Link className="btn btn-ghost" to="../plan">
                      See the plan →
                    </Link>
                  </div>
                </>
              ) : (
                <div className="notice info">No day of the trip is in {city} yet. Set the city on a day (Plan tab) to plan your backup ideas over it.</div>
              )}
              {cityFavs.length === 0 && <p className="small muted">Tap ＋ on things to do (below) to keep them as backup ideas, or tap one to read about it first.</p>}
            </div>

            {dates.map((d) => {
              const list = entriesOn(d)
              const pace = dayCapacity(trip, [], d)
              const used = list.reduce((sum, e) => sum + entryMinutes(e), 0)
              const open = openDays[d] ?? (d >= today() && dates.length <= 3) // past days start folded
              const status = d < today() ? 'past' : used >= pace ? `${formatDuration(used * 60)} planned · full` : `${formatDuration(used * 60)} of ${formatDuration(pace * 60)} planned`
              return (
                <Section
                  key={d}
                  open={open}
                  onToggle={() => setOpenDays((o) => ({ ...o, [d]: !open }))}
                  title={`Day ${dayNo(d)} · ${formatDate(d)}`}
                  summary={`· ${plural(list.length, 'activity', 'activities')} · ${status}`}
                >
                  <Progress value={used} max={pace || 1} over={used > pace} />
                  {list.some((e) => (e.item?.location?.lat ?? e.fav?.lat) != null) && (
                    <div className="row wrap">
                      <button className="btn-sm" onClick={() => showOnMap(d)}>
                        🗺️ Show this day on the map
                      </button>
                      <OptimiseDayButton tripId={trip.id} date={d} settings={settings} />
                    </div>
                  )}
                  {list.some((e) => (e.item?.location?.lat ?? e.fav?.lat) != null) && (
                    <WalkSettings
                      key={d + (days.find((x) => x.date === d)?.walkStart?.name ?? '')}
                      day={days.find((x) => x.date === d)}
                      defaultAround={settings.getAround ?? 'transit'}
                      stay={items.find((i) => i.kind === 'stay' && i.date <= d && d < addDays(i.date, i.nights ?? 1) && i.location?.lat != null)?.title}
                      onSave={async (changes) => {
                        const day = days.find((x) => x.date === d)
                        if (!day) return
                        await db.days.update(day.id, changes)
                        await rebuild([d])
                      }}
                    />
                  )}
                  {list.length === 0 && <span className="small muted">Nothing planned yet: add backup ideas or new places, then “Plan my days”.</span>}
                  {list.map((e) => (
                    <EntryRow
                      key={e.key}
                      entry={e}
                      date={d}
                      dates={dates}
                      dayNo={dayNo}
                      // A wishlist place opens its page (about it, its day); anything else opens the item to edit.
                      onOpen={() => (e.fav && (!e.item || e.item.favId === e.fav.id) ? openFav(e.fav) : setEditing(e.item))}
                      onMove={(to: string | undefined) => (to ? entryToDay(e, to) : entryToBackup(e))}
                      onRemove={() => entryRemove(e)}
                    />
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
                    {focusRoute?.stops.length ? (
                      <>
                        <span className="muted">
                          {focusRoute.stops.length} {focusRoute.stops.length === 1 ? 'place' : 'places'} · {GET_AROUND_LABEL[days.find((x) => x.date === focus)?.getAround ?? settings.getAround ?? 'transit']}
                        </span>
                        <ol style={{ margin: 0, paddingLeft: 20 }}>
                          {focusRoute.stops.map(({ item: it, leg }) => (
                            <li key={it.id}>
                              {it.startTime && <b>{it.startTime} </b>}
                              {(() => {
                                const f = cityFavs.find((x) => x.id === it.favId || x.itemId === it.id)
                                return f ? (
                                  <button
                                    type="button"
                                    className="btn-ghost"
                                    style={{
                                      padding: 0,
                                      minHeight: 0,
                                      border: 0,
                                      color: 'var(--primary)',
                                    }}
                                    onClick={() => openFav(f)}
                                  >
                                    {it.title}
                                  </button>
                                ) : (
                                  it.title
                                )
                              })()}
                              {!it.planner && !it.favId && <span className="tiny muted"> · from your plan</span>}
                              {leg && (
                                <div className="tiny muted">
                                  {legText(leg, distance)}
                                  {leg.fromName ? ` from ${leg.fromName}` : ''}
                                </div>
                              )}
                            </li>
                          ))}
                        </ol>
                        <Link to={`../today?date=${focus}`} className="small">
                          Open this day in Day by day →
                        </Link>
                      </>
                    ) : (
                      <span className="muted">Nothing with a location on this day yet. Add backup ideas, then “Plan my days”.</span>
                    )}
                  </div>
                )}
                {mapSize !== 'hidden' && !focus && (
                  <div className="row wrap" style={{ gap: 6 }}>
                    <span className="tiny muted">{searched ? 'Things to do follow the map: they are from the area on screen.' : 'Move or zoom the map and things to do follow what’s on screen.'}</span>
                    {searched && (
                      <button className="btn-sm" onClick={() => setSearched(undefined)}>
                        ↩ Back to the city centre
                      </button>
                    )}
                  </div>
                )}
                {mapSize !== 'hidden' && <LazyMap key={mapSize} markers={markers} segments={focusSegments} center={center} zoom={13} fitKey={fitKey} className={mapSize === 'large' ? 'tall' : 'short'} locate onMoveEnd={setView} />}
              </div>
            )}

            <Section open={findIsOpen} onToggle={() => setFindOpen(!findIsOpen)} title="🔎 Things to do" summary={findIsOpen ? undefined : '· sights and ChatGPT ideas · add your own'}>
              <IdeasStatus
                city={city}
                api={api}
                count={ideasRead.ideas.length}
                status={ideasStatus}
                error={ideasRead.error}
                onAsk={() => askCityIdeas(trip.id, city, settings)}
                prompt={cityIdeasPrompt(
                  trip,
                  settings,
                  city,
                  placesIn(dates).map((i) => i.title),
                )}
                text={ideasText}
                onText={(t) => setCityIdeasText(trip.id, city, t)}
              />
              <ThingsToDo
                city={city}
                pois={sights.data}
                ideas={ideasRead.ideas}
                loading={sights.loading}
                error={sights.error ? (online ? 'The free sights services are busy — try again in a minute.' : 'You are offline — sights load when you are back online.') : undefined}
                noCenter={!center}
                isFav={(name, wikidata) => !!findFav(name, wikidata)}
                inPlan={inPlan}
                onToggleSight={toggleSight}
                onToggleIdea={toggleIdea}
                onOpenSight={openPoi}
                onOpenIdea={openIdea}
                center={area}
                interest={interest}
                rating={rated.loading}
              />
              <details className="card tight">
                <summary className="small strong" style={{ cursor: 'pointer' }}>
                  ✏️ Add your own
                </summary>
                <div style={{ marginTop: 8 }}>
                  <OwnIdea city={city} onAdd={addFav} />
                </div>
              </details>
            </Section>
          </div>
        </div>
      )}

      {editing && <ItemEditor trip={trip} item={editing} city={city} area={center} onClose={() => setEditing(undefined)} />}

      {detail && city && (
        <PlaceModal
          subject={
            shown
              ? {
                  ...detail.subject,
                  interest: detail.subject.interest ?? shown.interest,
                }
              : detail.subject
          }
          city={city}
          inList={!!shown}
          inPlan={inPlan(detail.subject)}
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
function WalkSettings({ day, stay, defaultAround, onSave }: { day?: Day; stay?: string; defaultAround: GetAround; onSave: (changes: Partial<Day>) => void }) {
  const [place, setPlace] = useState<Place | undefined>(day?.walkStart)
  const from = day?.walkStart?.name ?? stay ?? `${day?.city ?? 'city'} centre`
  return (
    <details className="card tight">
      <summary className="small strong" style={{ cursor: 'pointer' }}>
        🧭 The day's route · {day?.walkStartTime ? `starts ${day.walkStartTime}` : 'starts after what is already planned'} · from {from}
        {day?.walkRoundTrip === false ? ' · no way back counted' : ' · ends at the hotel'} · {GET_AROUND_LABEL[day?.getAround ?? defaultAround].slice(0, 2)}
      </summary>
      <div className="stack" style={{ marginTop: 8, gap: 8 }}>
        <div className="form-grid">
          <label>
            Start time
            <input type="time" defaultValue={day?.walkStartTime ?? ''} onBlur={(e) => e.target.value !== (day?.walkStartTime ?? '') && onSave({ walkStartTime: e.target.value || undefined })} />
          </label>
          <label className="full">
            Between places
            <select
              value={day?.getAround ?? ''}
              onChange={(e) =>
                onSave({
                  getAround: (e.target.value || undefined) as GetAround | undefined,
                })
              }
            >
              <option value="">Default ({GET_AROUND_LABEL[defaultAround]})</option>
              {(Object.keys(GET_AROUND_LABEL) as GetAround[]).map((k) => (
                <option key={k} value={k}>
                  {GET_AROUND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="inline" style={{ alignSelf: 'end' }}>
            <input type="checkbox" checked={day?.walkRoundTrip !== false} onChange={(e) => onSave({ walkRoundTrip: e.target.checked ? undefined : false })} /> End the day at the hotel
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
          {f.itemId && ` · in your plan${f.date && !dates.includes(f.date) ? ` (day ${dayNo(f.date)})` : ''}`}
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

/** One thing on a day, whatever it came from, with the same choices: another day, the backup ideas, or remove. */
function EntryRow({
  entry: e,
  date,
  dates,
  dayNo,
  onOpen,
  onMove,
  onRemove,
}: {
  entry: Entry
  date: string
  dates: string[]
  dayNo: (d: string) => number
  onOpen: () => void
  onMove: (d: string | undefined) => void
  onRemove: () => void
}) {
  const it = e.item
  const f = e.fav
  const emoji = f ? categoryMeta(f.category).emoji : KIND_META[it!.kind].emoji
  const name = f?.name ?? it!.title
  const from = it?.status === 'booked' ? '✅ booked' : f ? (f.source === 'ai' ? '✨ ChatGPT idea' : f.source === 'sight' ? '🏛️ sight' : '✏️ yours') : '📋 from your plan'
  return (
    <div className="row" style={{ alignItems: 'center' }}>
      <span style={{ fontSize: '1.2rem' }}>{emoji}</span>
      <div className="grow" style={{ cursor: 'pointer' }} onClick={onOpen} role="button" tabIndex={0} onKeyDown={(ev) => ev.key === 'Enter' && onOpen()}>
        <div className="small strong">
          {it?.startTime && <span className="muted">{it.startTime} </span>}
          {name} {f?.interest && <Stars value={f.interest.stars} title={interestTier(f.interest.stars)} />}
          {it?.locked && ' 📌'}
        </div>
        <div className="tiny muted">
          ~{formatDuration(entryMinutes(e) * 60)} · {from}
          {!it && ' · not timed yet'}
          {(it?.notes ?? f?.notes) && ` · ${it?.notes ?? f?.notes}`}
        </div>
      </div>
      <TripadvisorLink name={name} city={f?.city ?? ''} />
      <select className="btn-sm" style={{ width: 'auto', minHeight: 30, padding: '2px 6px' }} value={date} onChange={(ev) => onMove(ev.target.value || undefined)} aria-label="Day">
        <option value="">🧺 Backup</option>
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

/** Where ChatGPT's ideas for the city stand: asked for by itself with an API key; with copy and paste, a prompt to paste. */
function IdeasStatus(p: {
  city: string
  api: boolean
  count: number
  status?: 'asking' | { error: string }
  error?: string
  onAsk: () => void
  prompt: string
  text: string
  onText: (t: string) => void
}) {
  if (p.api) {
    if (p.status === 'asking') return <p className="small muted">✨ Asking ChatGPT for ideas in {p.city}… they'll join the list below.</p>
    const err = typeof p.status === 'object' ? p.status.error : p.error
    return (
      <div className="row wrap" style={{ gap: 6 }}>
        {err ? (
          <span className="small" style={{ color: 'var(--danger, #b91c1c)' }}>
            ChatGPT ideas: {err}
          </span>
        ) : (
          p.count > 0 && <span className="tiny muted">✨ {p.count} ideas from ChatGPT are in the list.</span>
        )}
        <button className="btn-sm btn-ghost" onClick={p.onAsk}>
          {err || !p.count ? '✨ Ask ChatGPT for ideas' : '↻ New ideas'}
        </button>
      </div>
    )
  }
  return (
    <details className="card tight">
      <summary className="small strong" style={{ cursor: 'pointer' }}>
        ✨ {p.count ? `${p.count} ChatGPT ideas in the list · change them` : 'Add ChatGPT ideas'}
      </summary>
      <div className="stack" style={{ gap: 8, marginTop: 8 }}>
        <p className="tiny muted">Restaurants, experiences and day trips that map data misses. Copy the prompt into a free chatbot and paste its answer: the ideas join the list.</p>
        <PromptBox prompt={p.prompt} onAnswer={p.onText} />
        <AnswerBox label="Paste the chatbot's answer" minHeight={80} value={p.text} placeholder='{"ideas": [ … ]}' onChange={p.onText} />
        {p.error && <div className="notice error">{p.error}</div>}
      </div>
    </details>
  )
}

type Thing = {
  key: string
  name: string
  category: string
  lat?: number
  lon?: number
  visitMin?: number
  stars?: number
  notes?: string
  poi?: Poi
  idea?: CityIdea
  both?: boolean
}

/** Sights from the map and ChatGPT's ideas in one list, the most interesting (or the nearest) first. */
function ThingsToDo(p: {
  city: string
  pois?: Poi[]
  ideas: CityIdea[]
  loading: boolean
  error?: string
  noCenter: boolean
  center?: LatLon
  isFav: (name: string, wikidata?: string) => boolean
  inPlan: (x: { name: string; lat?: number; lon?: number; wikidata?: string }) => string | undefined
  onToggleSight: (x: Poi) => void
  onToggleIdea: (x: CityIdea) => void
  onOpenSight: (x: Poi) => void
  onOpenIdea: (x: CityIdea) => void
  interest: Map<string, Interest>
  rating: boolean
}) {
  const [cat, setCat] = useState<string>()
  const [sort, setSort] = useState<'interest' | 'near'>('interest')
  const norm = (n: string) =>
    n
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  const things: Thing[] = (p.pois ?? []).map((x) => ({
    key: x.id,
    name: x.name,
    category: x.category,
    lat: x.lat,
    lon: x.lon,
    visitMin: x.visitMin,
    stars: p.interest.get(x.id)?.stars,
    poi: x,
  }))
  for (const i of p.ideas) {
    // An idea that is also on the map shows once, as the sight, marked as suggested by ChatGPT too.
    const same = things.find((t) => t.poi && (norm(t.name) === norm(i.name) || (norm(i.name).length > 5 && (norm(t.name).includes(norm(i.name)) || norm(i.name).includes(norm(t.name))))))
    if (same) same.both = true
    else
      things.push({
        key: `idea:${i.name}`,
        name: i.name,
        category: CATEGORY_META[i.category] ? i.category : 'attraction',
        lat: i.lat,
        lon: i.lon,
        visitMin: i.visitMin,
        notes: i.notes,
        idea: i,
      })
  }
  // ChatGPT picked its ideas for this trip: they rank like a well-known sight (4★) until you sort by distance.
  const score = (t: Thing) => (t.idea ? 4 : (t.stars ?? 0)) + (t.both ? 1 : 0)
  const far = (t: Thing) => (p.center && t.lat != null && t.lon != null ? haversineM(p.center, { lat: t.lat, lon: t.lon }) : Infinity)
  const list = things.filter((t) => !cat || t.category === cat).sort((a, b) => (sort === 'near' ? far(a) - far(b) : score(b) - score(a) || (b.poi?.score ?? 0) - (a.poi?.score ?? 0)))
  const cats = [...new Set(things.map((t) => t.category))]
  return (
    <div className="stack" style={{ gap: 8 }}>
      {p.noCenter && <p className="small muted">This city has no coordinates yet, so sights can't be found on the map — tap “Find” on the day's city (Plan tab) or search above.</p>}
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
      {!p.loading && !p.rating && p.interest.size > 0 && <p className="tiny muted">Stars show how widely a place is written about on Wikipedia, not visitor reviews. ✨ marks ChatGPT's ideas.</p>}
      {p.error && <div className="notice error">{p.error}</div>}
      <div className="poi-list">
        {list.map((t) => {
          const fav = p.isFav(t.name, t.poi?.wikidata)
          const planned = p.inPlan({
            name: t.name,
            lat: t.lat,
            lon: t.lon,
            wikidata: t.poi?.wikidata,
          })
          return (
            <div key={t.key} className={`poi ${fav || planned ? 'on' : ''}`} onClick={() => (t.poi ? p.onOpenSight(t.poi) : p.onOpenIdea(t.idea!))}>
              <span style={{ fontSize: '1.3rem' }}>{categoryMeta(t.category).emoji}</span>
              <div className="grow">
                <div className="strong small">
                  {t.name} {t.stars != null && <Stars value={t.stars} title={interestTier(t.stars)} />}
                  {(t.idea || t.both) && <span title="Suggested by ChatGPT"> ✨</span>}
                </div>
                <div className="tiny muted">
                  {categoryMeta(t.category).label}
                  {p.center && t.lat != null && t.lon != null && ` · ${distance(far(t))} from centre`}
                  {t.visitMin ? ` · ~${formatDuration(t.visitMin * 60)}` : ''}
                  {t.notes && ` · ${t.notes}`}
                </div>
              </div>
              <TripadvisorLink name={t.name} city={p.city} />
              {planned ? (
                <span className="badge done" title="Already on one of your days">
                  📅 {planned}
                </span>
              ) : (
                <button
                  className={`btn-sm ${fav ? 'btn-primary' : ''}`}
                  aria-label="Add to the backup ideas"
                  onClick={(ev) => {
                    ev.stopPropagation()
                    if (t.poi) p.onToggleSight(t.poi)
                    else p.onToggleIdea(t.idea!)
                  }}
                >
                  {fav ? '✓' : '＋'}
                </button>
              )}
            </div>
          )
        })}
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
    await onAdd({
      name: place.name,
      lat: place.lat,
      lon: place.lon,
      category,
      visitMin: minutes,
      indoor,
      source: 'manual',
      notes: notes || undefined,
    })
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
          🧺 Add to backup ideas
        </button>
      </div>
    </div>
  )
}
