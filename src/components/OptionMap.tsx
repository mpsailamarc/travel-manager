import { useMemo } from 'react'
import type { Trip } from '../types'
import { optionStops, type AiOption } from '../lib/ai'
import { searchPlaces } from '../lib/apis'
import { cityIn } from '../lib/cities'
import { country } from '../lib/countries'
import { isHome } from '../lib/home'
import { useAsync } from '../lib/hooks'
import LazyMap, { type MapMarker } from './LazyMap'
import { t, tn } from '../i18n'

/** Where an option's places are: the coordinates it came with, else the well-known cities, else a (cached, one-a-second) search. */
async function locate(trip: Trip, stops: ReturnType<typeof optionStops>) {
  const names = trip.countryCodes.map((c) => country(c)?.name).filter(Boolean)
  const out: (typeof stops[number] & { lat: number; lon: number })[] = []
  for (const s of stops) {
    if (isHome(trip, { name: s.name, lat: s.lat, lon: s.lon })) continue
    if (s.lat != null && s.lon != null) {
      out.push({ ...s, lat: s.lat, lon: s.lon })
      continue
    }
    const known = cityIn(s.name)
    if (known) {
      out.push({ ...s, lat: known.lat, lon: known.lon })
      continue
    }
    try {
      const hits = await searchPlaces(names.length === 1 ? `${s.name}, ${names[0]}` : s.name)
      const hit = hits.find((h) => h.countryCode && trip.countryCodes.includes(h.countryCode)) ?? hits[0]
      if (hit) out.push({ ...s, lat: hit.lat, lon: hit.lon })
    } catch {
      /* a place that can't be found is left off the map */
    }
    await new Promise((r) => setTimeout(r, 1100)) // the search service asks for a second between requests
  }
  return out
}

/** The route of one itinerary option on a small map: its places numbered in order, joined by a dashed line. */
export function OptionMap({ option, trip, tall }: { option: AiOption; trip: Trip; tall?: boolean }) {
  const stops = useMemo(() => optionStops(option), [option])
  const key = stops.map((s) => `${s.name}:${s.lat ?? ''}:${s.lon ?? ''}`).join('|')
  const found = useAsync(() => locate(trip, stops), [key, trip.id])
  const points = found.data ?? []
  const markers: MapMarker[] = points.map((p, i) => ({ id: `${i}`, lat: p.lat, lon: p.lon, label: String(i + 1), variant: 'on', title: `${i + 1}. ${p.name}${p.nights ? ` · ${tn(p.nights, '{n} day', '{n} days')}` : ''}` }))
  if (!stops.length) return null
  if (!points.length) return <div className={`map ${tall ? 'tall' : 'short'}`} style={{ display: 'grid', placeItems: 'center' }}><span className="tiny muted">{found.loading ? t('Finding the places…') : t('No places to show')}</span></div>
  return (
    <div className="stack" style={{ gap: 4 }}>
      <LazyMap
        markers={markers}
        segments={points.slice(1).map((p, i) => ({ coords: [[points[i].lon, points[i].lat], [p.lon, p.lat]] as [number, number][], dashed: true, color: '#64748b' }))}
        key={String(!!tall)}
        fitKey={key + points.length}
        className={tall ? 'tall' : 'short'}
      />
      {found.loading && <span className="tiny muted">{t('Finding the other places…')}</span>}
    </div>
  )
}
