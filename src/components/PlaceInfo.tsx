import { useState } from 'react'
import type { Item } from '../types'
import type { LatLon } from '../lib/geo'
import { findWikipedia, placesFromTitle, wikiSummary } from '../lib/apis'
import { tripadvisorSearch } from '../lib/links'
import { useAsync, useOnline } from '../lib/hooks'
import { isTransport } from './kinds'
import { t } from '../i18n'

const TRAIL = /hike|hiking|trail|trek|walk|mirador|lookout|viewpoint|summit|peak|glacier|valley|lagoon|laguna|lake|waterfall|canyon|gorge|volcano|ridge|pass\b|cerro|mount|mt\.?\s/i

/** What a link points to, for a friendlier button label. */
export function linkLabel(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    if (host.includes('alltrails.')) return t('🥾 Open in AllTrails')
    if (host.includes('wikiloc.')) return t('🥾 Open in Wikiloc')
    if (host.includes('tripadvisor.')) return t('🦉 Open on Tripadvisor')
    if (host.includes('booking.')) return t('🛏️ Open on Booking.com')
    if (host.includes('airbnb.')) return t('🛏️ Open on Airbnb')
    if (host.includes('google.') && url.includes('/maps')) return t('🗺️ Open in Maps')
    return `🔗 ${host}`
  } catch {
    return t('🔗 Open link')
  }
}

export function wikiUrl(tag: string) {
  const m = tag.match(/^([a-z-]+):(.+)$/)
  return m ? `https://${m[1]}.wikipedia.org/wiki/${encodeURIComponent(m[2].replace(/ /g, '_'))}` : undefined
}

/**
 * About a plan item: the matching Wikipedia article (looked up automatically when the item has no link),
 * your own link, and quick links to maps, Wikivoyage and AllTrails. Everything opens in the browser or app — no accounts needed.
 */
export function PlaceInfo({ item, city, area, lang, country }: { item: Item; city?: string; area?: LatLon; lang?: string; country?: string }) {
  const online = useOnline()
  const place = isTransport(item.kind) ? item.to : item.location
  const near = place?.lat != null && place.lon != null ? { lat: place.lat, lon: place.lon } : undefined
  const lookUp = !isTransport(item.kind) && item.kind !== 'note' && item.kind !== 'stay' && !item.walk

  // The place's own name ("Castelo de São Jorge") matches better than the activity title; the lookup also digs
  // place names out of the title ("Hike to Grey lookout" → "Grey") and checks results are near the day's city.
  const wiki = useAsync(
    () =>
      lookUp && online
        ? findWikipedia({ title: item.title, place: place?.name !== item.title ? place?.name : undefined, near, area, city, lang, country })
        : Promise.resolve(undefined),
    [item.title, place?.name, near?.lat, near?.lon, area?.lat, area?.lon, city, lang, country, online],
  )
  const q = [place?.name ?? item.title, city].filter(Boolean).join(', ')
  const mapUrl = near ? `https://www.google.com/maps/search/?api=1&query=${near.lat},${near.lon}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
  // City walks built from sights don't need AllTrails; hikes and free-form walks do.
  // Tripadvisor search for places you'd look up reviews for: the place's own name, else the name inside the title ("Lunch: sardines in Alfama" → Alfama).
  const taName = place?.name && place.name !== item.title ? place.name : placesFromTitle(item.title)[0] ?? item.title
  const taQuery = isTransport(item.kind) || item.kind === 'note' || item.walk?.stops.length ? undefined : taName
  const trail = (item.kind === 'walk' && !item.walk?.stops.length) || (!item.walk && TRAIL.test(item.title))
  const allTrails = `https://www.google.com/search?q=${encodeURIComponent(`site:alltrails.com ${item.title}${city ? ` ${city}` : ''}`)}`

  return (
    <div className="stack" style={{ gap: 10 }}>
      {lookUp && wiki.loading && <p className="small muted">{t('Looking it up on Wikipedia…')}</p>}
      {wiki.data && <WikiCard key={wiki.data.title} title={wiki.data.title} extract={wiki.data.extract} image={wiki.data.image ?? wiki.data.thumbnail} thumbnail={wiki.data.thumbnail} url={wiki.data.url} />}
      {lookUp && !wiki.loading && !wiki.data && (
        <p className="small muted">
          {online ? t('No matching Wikipedia article found.') : t('Wikipedia lookups need an internet connection.')}{' '}
          {online && (
            <a href={`https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}`} target="_blank" rel="noreferrer">
              {t('Search Wikipedia ↗')}
            </a>
          )}
        </p>
      )}

      {item.walk && item.walk.stops.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <b className="small">{t('Stops')}</b>
          {item.walk.stops.map((s, i) => (
            <StopLink key={s.id} n={i + 1} name={s.name} wikipedia={s.wikipedia} wikidata={s.wikidata} city={city} near={{ lat: s.lat, lon: s.lon }} lang={lang} country={country} />
          ))}
        </div>
      )}

      <div className="row wrap">
        {item.url && (
          <a className="btn btn-sm btn-primary" href={item.url} target="_blank" rel="noreferrer">
            {linkLabel(item.url)}
          </a>
        )}
        <a className="btn btn-sm" href={mapUrl} target="_blank" rel="noreferrer">
          {t('🗺️ Map')}
        </a>
        {taQuery && !item.url?.includes('tripadvisor.') && (
          <a className="btn btn-sm" href={tripadvisorSearch(taQuery, city)} target="_blank" rel="noreferrer" title={t("Opens Tripadvisor's search for this place")}>
            {t('🦉 Find on Tripadvisor')}
          </a>
        )}
        {trail && !item.url?.includes('alltrails.') && (
          <a className="btn btn-sm" href={allTrails} target="_blank" rel="noreferrer" title={t('Searches AllTrails for this trail')}>
            {t('🥾 Find on AllTrails')}
          </a>
        )}
        {city && (
          <a className="btn btn-sm" href={`https://en.wikivoyage.org/wiki/${encodeURIComponent(city.replace(/ /g, '_'))}`} target="_blank" rel="noreferrer">
            {t('📖 {city} travel guide', { city })}
          </a>
        )}
      </div>
      {trail && !item.url && (
        <p className="tiny muted">{t('Found the trail on AllTrails? Copy its link into this item\'s “Link” field (Edit) — it then opens straight in the AllTrails app.')}</p>
      )}
    </div>
  )
}

export function WikiCard({ title, extract, image, thumbnail, url }: { title: string; extract: string; image?: string; thumbnail?: string; url: string }) {
  const [src, setSrc] = useState(image)
  return (
    <div className="wiki-card">
      {src && (
        <a href={url} target="_blank" rel="noreferrer" className="wiki-hero">
          {/* If the large size isn't available, fall back to the small thumbnail. */}
          <img src={src} alt={title} onError={() => setSrc(src !== thumbnail ? thumbnail : undefined)} />
        </a>
      )}
      <div className="stack" style={{ gap: 8 }}>
        <h3 style={{ fontSize: '1.2rem' }}>{title}</h3>
        <p style={{ lineHeight: 1.5 }}>{extract}</p>
        <div>
          <a className="btn btn-primary" href={url} target="_blank" rel="noreferrer">
            {t('📖 Read on Wikipedia ↗')}
          </a>
        </div>
      </div>
    </div>
  )
}

function StopLink({ n, name, wikipedia, wikidata, city, near, lang, country }: { n: number; name: string; wikipedia?: string; wikidata?: string; city?: string; near: LatLon; lang?: string; country?: string }) {
  // Stops picked from sights carry their article; others are looked up like any place.
  const { data } = useAsync(() => (wikipedia || wikidata ? wikiSummary({ wikipedia, wikidata }) : findWikipedia({ title: name, near, area: near, city, lang, country })), [name])
  const url = data?.url ?? (wikipedia ? wikiUrl(wikipedia) : undefined)
  return (
    <div className="row small">
      <span className="muted" style={{ width: 18 }}>
        {n}.
      </span>
      <span className="grow">{name}</span>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          {t('Wikipedia ↗')}
        </a>
      ) : (
        <span className="tiny muted">—</span>
      )}
    </div>
  )
}
