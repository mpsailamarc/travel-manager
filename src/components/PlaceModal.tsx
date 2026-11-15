import type { ReactNode } from 'react'
import { findWikipedia, interestOf, interestTier, localWiki, monthlyViews, POI_CATEGORIES, wikiSummary, type Interest } from '../lib/apis'
import { country } from '../lib/countries'
import { formatDuration } from '../lib/dates'
import { useAsync, useOnline } from '../lib/hooks'
import { tripadvisorSearch } from '../lib/links'
import { useTripCtx } from '../pages/TripLayout'
import { WikiCard } from './PlaceInfo'
import { Modal, Stars } from './ui'

/** What the window needs to know about a place, whether it came from a sights search, an AI idea or the wishlist. */
export interface PlaceSubject {
  name: string
  category: string
  lat?: number
  lon?: number
  wikipedia?: string
  wikidata?: string
  openingHours?: string
  fee?: string
  description?: string
  notes?: string
  visitMin?: number
  indoor?: boolean
  interest?: Interest
}

const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n))

/** "https://pt.wikipedia.org/wiki/Torre_de_Bel%C3%A9m" → { lang: 'pt', title: 'Torre de Belém' } */
function fromUrl(url?: string) {
  const m = url?.match(/^https:\/\/([a-z-]+)\.wikipedia\.org\/wiki\/(.+)$/)
  return m ? { lang: m[1], title: decodeURIComponent(m[2]).replace(/_/g, ' ') } : undefined
}

/**
 * A place in a window over the page: photo and description, how interesting it is, the practical facts, and what to do with it
 * (add to or remove from the wishlist, pick a day, open in maps or Tripadvisor).
 */
export function PlaceModal({
  subject,
  city,
  inList,
  inPlan,
  onToggle,
  onClose,
  onInterest,
  dayPicker,
  addLabel = '🎯 Add to wishlist',
  removeLabel = 'Remove from wishlist',
}: {
  subject: PlaceSubject
  city?: string
  inList: boolean
  inPlan?: string // "Day 3" when it's already on one of your days
  onToggle: () => void
  onClose: () => void
  onInterest?: (i: Interest) => void // to remember the rating on the wishlist entry
  dayPicker?: ReactNode
  addLabel?: string
  removeLabel?: string
}) {
  const { trip } = useTripCtx()
  const online = useOnline()
  const near = subject.lat != null && subject.lon != null ? { lat: subject.lat, lon: subject.lon } : undefined
  const meta = POI_CATEGORIES[subject.category]

  const wiki = useAsync(async () => {
    if (!online) return undefined
    if (subject.wikipedia || subject.wikidata) {
      const w = await wikiSummary(subject).catch(() => undefined)
      if (w) return w
    }
    return findWikipedia({ title: subject.name, near, area: near, city, lang: localWiki(trip.countryCodes[0]), country: country(trip.countryCodes[0])?.name })
  }, [subject.name, online])

  const article = fromUrl(wiki.data?.url)
  const rating = useAsync(async () => {
    if (subject.interest) return subject.interest
    if (wiki.loading) return undefined
    const tag = subject.wikipedia ?? (article ? `${article.lang}:${article.title}` : undefined)
    const r = (await interestOf([{ key: 'p', wikipedia: tag, wikidata: subject.wikidata }])).get('p')
    if (r) onInterest?.(r)
    return r
  }, [subject.name, wiki.loading, wiki.data?.url])
  const views = useAsync(() => (article ? monthlyViews(article.lang, article.title) : Promise.resolve(undefined)), [wiki.data?.url])
  const r = rating.data

  const q = [subject.name, city].filter(Boolean).join(', ')
  const mapUrl = near ? `https://www.google.com/maps/search/?api=1&query=${near.lat},${near.lon}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`

  return (
    <Modal
      title={
        <span>
          {meta?.emoji ?? '⭐'} {subject.name}
        </span>
      }
      onClose={onClose}
    >
      <div className="stack">
        <div className="card tight stack" style={{ gap: 4 }}>
          {r ? (
            <>
              <div className="row" style={{ gap: 8 }}>
                <Stars value={r.stars} />
                <b className="small">{interestTier(r.stars)}</b>
              </div>
              <div className="tiny muted">
                Written about in {r.langs} Wikipedia language{r.langs === 1 ? '' : 's'}
                {views.data != null && ` · ~${compact(views.data)} views a month`}. A guide to how well known it is, not visitor reviews.
              </div>
            </>
          ) : (
            <div className="small muted">{rating.loading || wiki.loading ? 'Checking how well known it is…' : 'No rating: little is written about it online, so it may be a quiet local spot.'}</div>
          )}
        </div>

        <div className="chips" style={{ pointerEvents: 'none' }}>
          {meta && <span className="chip">{meta.label}</span>}
          {subject.visitMin != null && <span className="chip">~{formatDuration(subject.visitMin * 60)}</span>}
          {subject.indoor && <span className="chip">Indoor</span>}
          {subject.openingHours && <span className="chip">🕘 {subject.openingHours}</span>}
          {subject.fee && <span className="chip">Fee: {subject.fee}</span>}
        </div>
        {subject.notes && <p className="small">{subject.notes}</p>}

        {wiki.loading && <p className="small muted">Loading description…</p>}
        {wiki.data ? (
          <WikiCard key={wiki.data.title} title={wiki.data.title} extract={wiki.data.extract} image={wiki.data.image ?? wiki.data.thumbnail} thumbnail={wiki.data.thumbnail} url={wiki.data.url} />
        ) : (
          !wiki.loading && <p className="small">{subject.description ?? (online ? 'No matching Wikipedia article found.' : 'Descriptions need an internet connection.')}</p>
        )}

        <div className="row wrap">
          {inPlan && !inList ? (
            <span className="badge done" style={{ alignSelf: 'center' }}>
              📅 Already in your plan · {inPlan}
            </span>
          ) : (
            <button className={inList ? '' : 'btn-primary'} onClick={onToggle}>
              {inList ? removeLabel : addLabel}
            </button>
          )}
          {dayPicker}
          <a className="btn btn-ghost" href={mapUrl} target="_blank" rel="noreferrer">
            🗺️ Map
          </a>
          <a className="btn btn-ghost" href={tripadvisorSearch(subject.name, city)} target="_blank" rel="noreferrer">
            🦉 Tripadvisor ↗
          </a>
        </div>
      </div>
    </Modal>
  )
}
