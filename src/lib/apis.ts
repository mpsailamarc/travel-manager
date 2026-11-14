// Free, key-less public services. All are community-run or free for non-commercial use, so requests
// are kept light and results are cached on the device.
//   OpenStreetMap Overpass (points of interest) · FOSSGIS OSRM (walking routes) · Nominatim (place search)
//   Wikipedia / Wikidata (descriptions, photos) · Open-Meteo (weather) · Frankfurter / ECB (exchange rates)

import { haversineM, type LatLon } from './geo'
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
  'the and with from for tour walk walking hike hiking trek visit trip day half full lunch dinner breakfast brunch evening morning afternoon night sunset sunrise view views tickets ticket guided free early late around near into over via los las del des der die das dos old new hotel hostel apartment room rooms accommodation stay check rest relax pack packing time back return arrive arrival depart departure transfer drive flight bus train local best famous family kids children'.split(' '),
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

/* ---- Getting the place out of an activity title ("Hike to Grey lookout" → "Grey") ---- */

const ACTIVITY_LEAD =
  /^(?:(?:half|full)[- ]day\s+)?(?:visit|explore|discover|see|guided tour|tour|hike|hiking|walk|walking|trek|stroll|climb|drive|day trip|excursion|sunrise|sunset|lunch|dinner|breakfast|brunch|picnic|swim|boat trip|boat|ferry|catamaran|bike|cycle|kayak|tasting|shopping|relax|free time)\b[^,:]*?\b(?:to|at|in|of|around|through|along|on|up|from|by)\s+/i
const LEADING_VERB = /^(?:visit|explore|discover|see|stroll(?:\s+along)?|tour|hike|walk|trek|climb|enjoy|admire)\s+/i
const TRAILING = /\s+(?:at sunset|at sunrise|sunset|sunrise|hike|hiking|trek|walk|tour|visit|trip|day trip|viewpoint|lookout|stroll|excursion|tasting|boat trip|cruise|riverside|playground)$/i

/** Likely place names hidden in an activity title, most complete first. */
export function placesFromTitle(title: string): string[] {
  let t = title.replace(/\([^)]*\)/g, ' ').replace(/\s+[—–]\s+.*$|\s+-\s+.*$/, '')
  if (/→|->/.test(t)) return [] // transport between two places
  if (t.includes(':')) t = t.slice(t.indexOf(':') + 1)
  t = t.trim().replace(ACTIVITY_LEAD, '').replace(LEADING_VERB, '')
  for (let i = 0; i < 2; i++) t = t.replace(TRAILING, '')
  t = t.replace(/^the\s+/i, '').trim()
  const out = [t]
  const tail = t.match(/\s(?:in|at|near|on)\s+([A-ZÀ-Ý].+)$/) // "grilled sardines in Alfama" → "Alfama"
  if (tail) out.push(tail[1])
  out.push(...t.split(/\s+(?:&|and|\+|to)\s+|,\s*/))
  return [...new Set(out.map((x) => x.replace(TRAILING, '').trim()))].filter((x) => x.length > 2)
}

// Local-language Wikipedias worth a second try (Latin script, so names can be matched).
const LOCAL_WIKI: Record<string, string> = {
  ES: 'es', MX: 'es', AR: 'es', CL: 'es', PE: 'es', CO: 'es', CR: 'es', PT: 'pt', BR: 'pt', FR: 'fr', BE: 'fr', MA: 'fr',
  DE: 'de', AT: 'de', CH: 'de', IT: 'it', NL: 'nl', PL: 'pl', CZ: 'cs', HU: 'hu', SE: 'sv', NO: 'no', DK: 'da', HR: 'hr',
  TR: 'tr', ID: 'id', VN: 'vi', IS: 'is',
}
export const localWiki = (countryCode?: string) => (countryCode ? LOCAL_WIKI[countryCode.toUpperCase()] : undefined)

export interface WikiQuery {
  title: string // the activity title
  place?: string // the place name, when different from the title
  near?: LatLon // the item's own coordinates
  area?: LatLon // where you are that day (the day's city): results must be within 120 km
  city?: string
  country?: string // for articles without coordinates, the text must mention the city or the country
  lang?: string // local Wikipedia to try after English
}

// Common geographic nouns: matching one of these alone says little ("Lake", "Cave"); a proper name ("Chaxa") does.
const COMMON_PLACE = new Set(
  'laguna lagoon lake lago valley valle cave cueva mount monte cerro mountain peak hill beach playa river rio church iglesia cathedral catedral museum museo palace palacio park parque square plaza praca market mercado tower torre bridge puente castle castillo castelo garden jardin national natural monument monumento island isla waterfall cascada glacier glaciar desert desierto viewpoint mirador street calle avenue avenida station center centre'.split(' '),
)

interface Candidate {
  title: string
  lang: string
  wikidata?: string
  coords?: LatLon
  intro?: string
}

async function wikiNearby(lang: string, p: LatLon): Promise<Candidate[]> {
  type R = { query?: { pages: Record<string, { title: string; coordinates?: LatLon[]; pageprops?: { wikibase_item?: string } }> } }
  const r = await getJSON<R>(
    `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=geosearch&ggscoord=${p.lat}|${p.lon}&ggsradius=500&ggslimit=50&prop=coordinates|pageprops&ppprop=wikibase_item&colimit=max`,
  )
  return Object.values(r.query?.pages ?? {})
    .map((x) => ({ title: x.title, lang, wikidata: x.pageprops?.wikibase_item, coords: x.coordinates?.[0] }))
    .sort((a, b) => (a.coords && b.coords ? haversineM(p, a.coords) - haversineM(p, b.coords) : 0))
}

async function wikiSearch(lang: string, q: string): Promise<Candidate[]> {
  type R = {
    query?: { pages: Record<string, { title: string; index: number; coordinates?: LatLon[]; pageprops?: { wikibase_item?: string }; extract?: string }> }
  }
  const r = await getJSON<R>(
    `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrlimit=6&gsrsearch=${encodeURIComponent(q)}&prop=coordinates|pageprops|extracts&ppprop=wikibase_item&colimit=max&exintro=1&explaintext=1&exlimit=max&exchars=600`,
  )
  return Object.values(r.query?.pages ?? {})
    .sort((a, b) => a.index - b.index)
    .map((x) => ({ title: x.title, lang, wikidata: x.pageprops?.wikibase_item, coords: x.coordinates?.[0], intro: x.extract }))
}

/**
 * Finds the Wikipedia article for a plan item that has no link yet (e.g. created by the AI). It tries the place name
 * and the place names inside the title, in English and then the local language: first articles within 500 m of the
 * item, then a search by name and city. A result must share the distinctive words of the name (two, or the only one)
 * and, when the day's location is known, lie within 50 km of it. Better no article than a wrong one.
 */
export async function findWikipedia(q: WikiQuery): Promise<WikiSummary | undefined> {
  const key = `wikifind4:${[q.title, q.place, q.near && `${q.near.lat.toFixed(3)},${q.near.lon.toFixed(3)}`, q.city, q.lang].join('|').toLowerCase()}`
  const cached = cacheGet<{ hit?: Candidate }>(key, 30 * 864e5)
  let hit = cached?.hit
  if (!cached) {
    // City words don't count, in any spelling ("Lisboa" = "Lisbon").
    const cityWords = q.city ? keyWords(q.city) : []
    const isCity = (w: string) => cityWords.some((c) => sameWord(w, c) || (w.length >= 5 && c.length >= 5 && w.slice(0, 5) === c.slice(0, 5)))
    const names = [...new Set([q.place, ...placesFromTitle(q.title), q.title].filter((x): x is string => !!x))]
      .map((name) => ({ name, words: keyWords(name).filter((w) => !isCity(w)) }))
      .filter((n) => n.words.length)
      .slice(0, 5)
    const area = q.area ?? q.near
    const regionWords = [...cityWords, ...(q.country ? keyWords(q.country) : [])]
    const mentionsRegion = (intro?: string) => {
      const t = keyWords(intro ?? '')
      return regionWords.some((w) => t.some((x) => sameWord(w, x)))
    }
    const ok = (c: Candidate, words: string[]) => {
      if (area && c.coords && haversineM(area, c.coords) > 120_000) return false // parks and day trips can be far from town
      const hits = words.filter((w) => matches([w], c.title))
      const properName = hits.some((w) => w.length >= 4 && !COMMON_PLACE.has(w)) // "Chaxa", "Milodón", not "Lake"
      // Some articles have no coordinates ("Cueva del Milodón"): then the title must carry a proper name and the
      // opening paragraph must mention the city or the country — so "French Kiwi Juice" doesn't pass for "French Valley".
      if (area && !c.coords) return properName && mentionsRegion(c.intro)
      // Two shared words, or the only one; near the day's city a single proper name is enough.
      return hits.length >= Math.min(2, words.length) || (!!area && properName)
    }

    search: for (const lang of [...new Set(['en', q.lang ?? 'en'])]) {
      if (q.near) {
        const nearby = await wikiNearby(lang, q.near)
        for (const n of names) {
          // Right next to the place, one shared word is enough.
          hit = nearby.find((c) => matches(n.words, c.title) >= 1)
          if (hit) break search
        }
      }
      for (const n of names) {
        // With the city first (disambiguates), then the name alone (local-language searches choke on mixed words).
        const queries = q.city && !n.name.toLowerCase().includes(q.city.toLowerCase()) ? [`${n.name} ${q.city}`, n.name] : [n.name]
        for (const query of queries) {
          hit = (await wikiSearch(lang, query)).find((c) => ok(c, n.words))
          if (hit) break search
        }
      }
    }
    cacheSet(key, { hit })
  }
  // Prefer the English article when the match was found on the local Wikipedia.
  const summary = hit ? await wikiSummary({ wikipedia: `${hit.lang}:${hit.title}`, wikidata: hit.wikidata }) : undefined
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

/**
 * Rate to convert 1 `from` into `to`. European Central Bank data (Frankfurter) covers ~30 major currencies; for the
 * rest (Chilean peso, Peruvian sol, Moroccan dirham…) it falls back to ExchangeRate-API's free open endpoint
 * (166 currencies, daily). A manual rate always wins. Rates are cached for offline use.
 */
export async function fxRate(from: string, to: string): Promise<number | undefined> {
  if (from === to) return 1
  const manual = manualRates()[`${from}>${to}`]
  if (manual) return manual
  for (const source of ['ecb', 'erapi'] as const) {
    const key = `fx:${source}:${from}`
    let rates = cacheGet<Record<string, number>>(key, 12 * 3600e3)
    if (!rates) {
      try {
        rates =
          source === 'ecb'
            ? (await getJSON<{ rates: Record<string, number> }>(`https://api.frankfurter.dev/v1/latest?base=${from}`)).rates
            : (await getJSON<{ rates: Record<string, number> }>(`https://open.er-api.com/v6/latest/${from}`)).rates
        cacheSet(key, rates)
      } catch {
        rates = cacheGetStale<Record<string, number>>(key)
      }
    }
    if (rates?.[to]) return rates[to]
  }
  return undefined
}
