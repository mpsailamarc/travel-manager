// Free, key-less public services. All are community-run or free for non-commercial use, so requests
// are kept light and results are cached on the device.
//   OpenStreetMap Overpass (points of interest) · FOSSGIS OSRM (walking routes) · Nominatim (place search)
//   Wikipedia / Wikidata (descriptions, photos) · Open-Meteo (weather) · Frankfurter / ECB (exchange rates)

import type { LatLon } from './geo'
import type { WalkStop } from '../types'

const CACHE_PREFIX = 'tm-cache:'

function cacheGet<T>(key: string, maxAgeMs: number): T | undefined {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key)
    if (!raw) return undefined
    const { t, v } = JSON.parse(raw) as { t: number; v: T }
    return Date.now() - t < maxAgeMs ? v : undefined
  } catch {
    return undefined
  }
}

function cacheGetStale<T>(key: string): T | undefined {
  return cacheGet<T>(key, Infinity)
}

function cacheSet(key: string, v: unknown) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), v }))
  } catch {
    /* storage full: caching is best-effort */
  }
}

async function getJSON<T>(url: string, init?: RequestInit, timeoutMs = 15000): Promise<T> {
  // Free services can be slow or blocked on some networks: never let a request hang the UI.
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------ Place search ------------------------------ */

export interface GeoResult {
  name: string
  displayName: string
  lat: number
  lon: number
  countryCode?: string
}

// Nominatim's policy forbids autocomplete, so call this only on an explicit search.
export async function searchPlaces(q: string): Promise<GeoResult[]> {
  const key = 'geo:' + q.toLowerCase()
  const cached = cacheGet<GeoResult[]>(key, 30 * 864e5)
  if (cached) return cached
  type R = { name: string; display_name: string; lat: string; lon: string; address?: { country_code?: string } }
  const rows = await getJSON<R[]>(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(q)}`,
  )
  const out = rows.map((r) => ({
    name: r.name || r.display_name.split(',')[0],
    displayName: r.display_name,
    lat: Number(r.lat),
    lon: Number(r.lon),
    countryCode: r.address?.country_code?.toUpperCase(),
  }))
  cacheSet(key, out)
  return out
}

/* --------------------------- Points of interest --------------------------- */

export interface Poi extends WalkStop {
  description?: string
  openingHours?: string
  fee?: string
  score: number
}

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']

export const POI_CATEGORIES: Record<string, { label: string; emoji: string; visitMin: number }> = {
  museum: { label: 'Museums', emoji: '🏛️', visitMin: 90 },
  monument: { label: 'Monuments', emoji: '🗿', visitMin: 15 },
  castle: { label: 'Castles & palaces', emoji: '🏰', visitMin: 75 },
  religious: { label: 'Churches & temples', emoji: '⛪', visitMin: 30 },
  viewpoint: { label: 'Viewpoints', emoji: '🌄', visitMin: 15 },
  park: { label: 'Parks & gardens', emoji: '🌳', visitMin: 40 },
  attraction: { label: 'Attractions', emoji: '⭐', visitMin: 45 },
  family: { label: 'Zoos & aquariums', emoji: '🐠', visitMin: 150 },
}

function categorise(t: Record<string, string>): string {
  if (t.tourism === 'museum' || t.tourism === 'gallery') return 'museum'
  if (t.tourism === 'zoo' || t.tourism === 'aquarium' || t.tourism === 'theme_park') return 'family'
  if (t.tourism === 'viewpoint') return 'viewpoint'
  if (['castle', 'palace', 'fort'].includes(t.historic) || t.castle_type) return 'castle'
  if (t.amenity === 'place_of_worship' || ['church', 'monastery', 'cathedral'].includes(t.historic) || t.building === 'cathedral')
    return 'religious'
  if (t.leisure === 'park' || t.leisure === 'garden') return 'park'
  if (t.historic) return 'monument'
  return 'attraction'
}

/** Sights around a point: OpenStreetMap (Overpass) first, Wikipedia's geosearch as a fallback. */
export async function fetchPois(center: LatLon, radiusM = 2500): Promise<Poi[]> {
  const key = `poi:${center.lat.toFixed(3)},${center.lon.toFixed(3)},${radiusM}`
  const cached = cacheGet<Poi[]>(key, 14 * 864e5)
  if (cached) return cached
  // Both sources in parallel: OSM has better coverage, Wikipedia is the fallback (and fills gaps).
  const [osm, wiki] = await Promise.allSettled([overpassPois(center, radiusM), wikipediaPois(center, radiusM)])
  if (osm.status === 'rejected' && wiki.status === 'rejected') {
    const stale = cacheGetStale<Poi[]>(key)
    if (stale) return stale
    throw osm.reason
  }
  const out = osm.status === 'fulfilled' ? [...osm.value] : []
  const names = new Set(out.map((p) => p.name.toLowerCase()))
  const wikidata = new Set(out.map((p) => p.wikidata).filter(Boolean))
  if (wiki.status === 'fulfilled') {
    for (const w of wiki.value) if (!names.has(w.name.toLowerCase()) && !wikidata.has(w.wikidata)) out.push(w)
  }
  cacheSet(key, out)
  return out
}

async function overpassPois(center: LatLon, radiusM: number): Promise<Poi[]> {

  const a = `around:${radiusM},${center.lat},${center.lon}`
  const query = `[out:json][timeout:25];
(
  nwr(${a})["tourism"~"^(attraction|museum|gallery|viewpoint|zoo|aquarium|theme_park)$"]["name"];
  nwr(${a})["historic"~"^(monument|memorial|castle|palace|fort|ruins|archaeological_site|city_gate|church|monastery|tower|building)$"]["name"]["wikidata"];
  nwr(${a})["amenity"="place_of_worship"]["name"]["wikidata"];
  nwr(${a})["leisure"~"^(park|garden)$"]["name"]["wikidata"];
  nwr(${a})["man_made"~"^(tower|lighthouse)$"]["name"]["wikidata"];
);
out center tags 400;`

  type El = { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }
  // Try the mirrors in parallel and take the first that answers.
  const data = await Promise.any(
    OVERPASS.map((url) => getJSON<{ elements: El[] }>(url, { method: 'POST', body: new URLSearchParams({ data: query }) }, 10000)),
  )

  const seen = new Set<string>()
  const pois: Poi[] = []
  for (const el of data.elements) {
    const t = el.tags ?? {}
    const lat = el.lat ?? el.center?.lat
    const lon = el.lon ?? el.center?.lon
    if (!t.name || lat == null || lon == null) continue
    // Overpass returns nodes and ways for the same place: dedupe on wikidata or name.
    const dedupe = t.wikidata ?? t.name.toLowerCase()
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    const category = categorise(t)
    const score = (t.wikipedia ? 3 : 0) + (t.wikidata ? 2 : 0) + (t.tourism === 'attraction' ? 1 : 0) + (t.image ? 1 : 0) + (t.website ? 0.5 : 0)
    if (score < 1 && category !== 'museum' && category !== 'viewpoint') continue
    pois.push({
      id: `${el.type}/${el.id}`,
      name: t['name:en'] ?? t.name,
      lat,
      lon,
      category,
      visitMin: POI_CATEGORIES[category].visitMin,
      wikipedia: t.wikipedia,
      wikidata: t.wikidata,
      description: t.description,
      openingHours: t.opening_hours,
      fee: t.fee,
      score,
    })
  }
  pois.sort((x, y) => y.score - x.score)
  return pois.slice(0, 150)
}

const WIKI_KEEP: [RegExp, string][] = [
  [/museum|gallery/i, 'museum'],
  [/aquarium|zoo|theme park|oceanarium/i, 'family'],
  [/viewpoint|lookout|miradouro|belvedere/i, 'viewpoint'],
  [/castle|palace|fort\b|fortress|fortified|citadel|château/i, 'castle'],
  [/church|cathedral|basilica|chapel|monastery|convent\b|abbey|temple|mosque|synagogue|shrine|hermitage/i, 'religious'],
  [/garden|park\b/i, 'park'],
  [/monument|memorial|statue|tower|bridge|gate|arch|ruins|square|plaza|landmark|historic site|lighthouse|fountain|theatre|opera|market/i, 'monument'],
]
// Place descriptors ("District of Lisbon", "Civil parish in…") only count at the start: "…, Lisbon District, Portugal" is fine.
const WIKI_SKIP =
  /^(district|civil parish|parish|neighbou?rhood|place|village|town|city|municipality)\b|station|school|university|college|stadium|ministry|embassy|company|foundation|attack|festival|archive|government|directorate|football|hospital|street|avenue|road|hotel|airport|metro|railway|bus |club|party|election|battle|exhibition/i

async function wikipediaPois(center: LatLon, radiusM: number): Promise<Poi[]> {
  type P = {
    title: string
    description?: string
    coordinates?: { lat: number; lon: number }[]
    thumbnail?: { source: string }
    pageprops?: { wikibase_item?: string }
  }
  const r = await getJSON<{ query?: { pages: Record<string, P> } }>(
    `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=geosearch&ggscoord=${center.lat}|${center.lon}&ggsradius=${Math.min(10000, radiusM)}&ggslimit=100&prop=coordinates|pageimages|description|pageprops&colimit=max&pilimit=max&piprop=thumbnail&pithumbsize=160&ppprop=wikibase_item`,
  )
  const out: Poi[] = []
  for (const p of Object.values(r.query?.pages ?? {})) {
    const c = p.coordinates?.[0]
    const text = `${p.title} ${p.description ?? ''}`
    if (!c || WIKI_SKIP.test(p.description ?? '')) continue
    const hit = WIKI_KEEP.find(([re]) => re.test(text))
    const generic = /^(building|historic|monument) in/i.test(p.description ?? '')
    if (!hit && !generic) continue
    const category = hit?.[1] ?? 'attraction'
    out.push({
      id: `wiki/${p.pageprops?.wikibase_item ?? p.title}`,
      name: p.title.replace(/ \(.*\)$/, ''),
      lat: c.lat,
      lon: c.lon,
      category,
      visitMin: POI_CATEGORIES[category].visitMin,
      wikipedia: `en:${p.title}`,
      wikidata: p.pageprops?.wikibase_item,
      description: p.description,
      score: 2 + (p.thumbnail ? 1 : 0),
    })
  }
  return out.sort((a, b) => b.score - a.score)
}

/* ------------------------------ Walking route ----------------------------- */

export interface RouteResult {
  geometry: [number, number][]
  legs: { distanceM: number; durationS: number }[]
  distanceM: number
}

export async function walkingRoute(points: LatLon[]): Promise<RouteResult> {
  const coords = points.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';')
  const key = 'route:' + coords
  const cached = cacheGet<RouteResult>(key, 90 * 864e5)
  if (cached) return cached
  type R = {
    code: string
    routes: { distance: number; geometry: { coordinates: [number, number][] }; legs: { distance: number; duration: number }[] }[]
  }
  const r = await getJSON<R>(`https://routing.openstreetmap.de/routed-foot/route/v1/foot/${coords}?overview=full&geometries=geojson&steps=false`)
  if (r.code !== 'Ok' || !r.routes[0]) throw new Error('No route found')
  const route = r.routes[0]
  const out = {
    geometry: route.geometry.coordinates,
    legs: route.legs.map((l) => ({ distanceM: l.distance, durationS: l.duration })),
    distanceM: route.distance,
  }
  cacheSet(key, out)
  return out
}

/* -------------------------------- Wikipedia ------------------------------- */

export interface WikiSummary {
  title: string
  extract: string
  thumbnail?: string
  image?: string // ~900 px wide, for the large card
  url: string
}

export async function wikiSummary(poi: { wikipedia?: string; wikidata?: string }): Promise<WikiSummary | undefined> {
  let lang = 'en'
  let title: string | undefined
  if (poi.wikipedia) {
    const m = poi.wikipedia.match(/^([a-z-]+):(.+)$/)
    if (m) [, lang, title] = m
  }
  // Prefer the English article when the OSM tag points to the local-language one.
  if (poi.wikidata && (!title || lang !== 'en')) {
    try {
      type W = { entities: Record<string, { sitelinks?: Record<string, { title: string }> }> }
      const w = await getJSON<W>(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*&props=sitelinks&sitefilter=enwiki&ids=${poi.wikidata}`,
      )
      const en = w.entities[poi.wikidata]?.sitelinks?.enwiki?.title
      if (en) {
        lang = 'en'
        title = en
      }
    } catch {
      /* keep local-language article */
    }
  }
  if (!title) return undefined
  const key = `wiki2:${lang}:${title}`
  const cached = cacheGet<WikiSummary>(key, 30 * 864e5)
  if (cached) return cached
  type S = {
    title: string
    extract: string
    thumbnail?: { source: string }
    originalimage?: { source: string; width: number }
    content_urls?: { desktop: { page: string } }
  }
  const s = await getJSON<S>(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`)
  // Wikimedia only serves thumbnails in standard widths (500, 960, 1280… — 900 is refused): use 960 px, or 500 for smaller originals.
  const thumb = s.thumbnail?.source
  const ow = s.originalimage?.width ?? 0
  const width = ow > 960 ? 960 : ow > 500 ? 500 : 0
  const big = width && thumb && /\/\d+px-/.test(thumb) ? thumb.replace(/\/\d+px-/, `/${width}px-`) : s.originalimage?.source
  const out = {
    title: s.title,
    extract: s.extract,
    thumbnail: thumb,
    image: big ?? thumb,
    url: s.content_urls?.desktop.page ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
  }
  cacheSet(key, out)
  return out
}

// Words that say what you do, not where: they shouldn't decide which article matches.
const GENERIC = new Set(
  'the and with from for tour walk walking hike hiking trek visit trip day half full lunch dinner breakfast brunch evening morning afternoon night sunset sunrise view views tickets ticket guided free early late around near into over via los las del des der die das dos old new'.split(' '),
)

function keyWords(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !GENERIC.has(w))
}

// "Oceanário" ≈ "Oceanarium", "Basilica" ≈ "Basílica": compare word starts, not whole words.
const sameWord = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, 6) === b.slice(0, 6))

/** How many of the item's distinctive words (city words don't count) appear in an article title. */
function matches(nameWords: string[], title: string) {
  if (/\(disambiguation\)|^list of /i.test(title)) return 0 // pages that list meanings, not a place
  const t = keyWords(title)
  return nameWords.filter((w) => t.some((x) => sameWord(w, x))).length
}

/**
 * Finds the Wikipedia article for a plan item that has no link yet (e.g. created by the AI). With coordinates,
 * it takes the closest article within 500 m that shares a word with the name; otherwise it searches by name and
 * city and needs at least two matching words (or the only one). Better no article than a wrong one.
 */
export async function findWikipedia(name: string, near?: LatLon, city?: string): Promise<WikiSummary | undefined> {
  const key = `wikifind2:${name.toLowerCase()}|${near ? `${near.lat.toFixed(3)},${near.lon.toFixed(3)}` : ''}|${city ?? ''}`
  const cached = cacheGet<{ title?: string }>(key, 30 * 864e5)
  let title = cached?.title
  if (!cached) {
    const cityWords = city ? keyWords(city) : []
    const words = keyWords(name).filter((w) => !cityWords.some((c) => sameWord(w, c)))
    if (!words.length) return undefined
    if (near) {
      type G = { query?: { geosearch: { title: string }[] } }
      const g = await getJSON<G>(
        `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&list=geosearch&gscoord=${near.lat}|${near.lon}&gsradius=500&gslimit=50`,
      )
      title = g.query?.geosearch.find((x) => matches(words, x.title) >= 1)?.title // sorted by distance
    }
    if (!title) {
      type S = { query?: { search: { title: string }[] } }
      const q = encodeURIComponent(city && !name.toLowerCase().includes(city.toLowerCase()) ? `${name} ${city}` : name)
      const r = await getJSON<S>(`https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&list=search&srlimit=5&srsearch=${q}`)
      const need = Math.min(2, words.length)
      title = r.query?.search.find((x) => matches(words, x.title) >= need)?.title
    }
    cacheSet(key, { title })
  }
  const summary = title ? await wikiSummary({ wikipedia: `en:${title}` }) : undefined
  return summary && !/may refer to:?$/i.test(summary.extract.trim()) ? summary : undefined
}

/* --------------------------------- Weather -------------------------------- */

export interface DayWeather {
  date: string
  code: number
  tMax: number
  tMin: number
  rainChance?: number
}

export async function forecast(p: LatLon): Promise<DayWeather[]> {
  const key = `wx:${p.lat.toFixed(2)},${p.lon.toFixed(2)}`
  const cached = cacheGet<DayWeather[]>(key, 3 * 3600e3)
  if (cached) return cached
  try {
    type R = {
      daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: (number | null)[] }
    }
    const r = await getJSON<R>(
      `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=16`,
    )
    const out = r.daily.time.map((date, i) => ({
      date,
      code: r.daily.weather_code[i],
      tMax: r.daily.temperature_2m_max[i],
      tMin: r.daily.temperature_2m_min[i],
      rainChance: r.daily.precipitation_probability_max[i] ?? undefined,
    }))
    cacheSet(key, out)
    return out
  } catch (e) {
    const stale = cacheGetStale<DayWeather[]>(key)
    if (stale) return stale
    throw e
  }
}

export function weatherEmoji(code: number): { emoji: string; label: string } {
  if (code === 0) return { emoji: '☀️', label: 'Clear' }
  if (code <= 2) return { emoji: '🌤️', label: 'Partly cloudy' }
  if (code === 3) return { emoji: '☁️', label: 'Cloudy' }
  if (code <= 48) return { emoji: '🌫️', label: 'Fog' }
  if (code <= 57) return { emoji: '🌦️', label: 'Drizzle' }
  if (code <= 67) return { emoji: '🌧️', label: 'Rain' }
  if (code <= 77) return { emoji: '🌨️', label: 'Snow' }
  if (code <= 82) return { emoji: '🌧️', label: 'Showers' }
  if (code <= 86) return { emoji: '🌨️', label: 'Snow showers' }
  return { emoji: '⛈️', label: 'Thunderstorm' }
}

/* ----------------------------- Exchange rates ----------------------------- */

const MANUAL_RATES_KEY = 'tm-manual-rates'

export function manualRates(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(MANUAL_RATES_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function setManualRate(from: string, to: string, rate: number) {
  const r = manualRates()
  r[`${from}>${to}`] = rate
  localStorage.setItem(MANUAL_RATES_KEY, JSON.stringify(r))
}

/** Rate to convert 1 `from` into `to`. ECB data covers ~30 major currencies; others need a manual rate. */
export async function fxRate(from: string, to: string): Promise<number | undefined> {
  if (from === to) return 1
  const manual = manualRates()[`${from}>${to}`]
  if (manual) return manual
  const key = `fx:${from}`
  let rates = cacheGet<Record<string, number>>(key, 12 * 3600e3)
  if (!rates) {
    try {
      const r = await getJSON<{ rates: Record<string, number> }>(`https://api.frankfurter.dev/v1/latest?base=${from}`)
      rates = r.rates
      cacheSet(key, rates)
    } catch {
      rates = cacheGetStale<Record<string, number>>(key)
    }
  }
  return rates?.[to]
}
