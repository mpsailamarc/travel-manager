import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, NavLink, Outlet, useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { reconcileTrip } from '../lib/favorites'
import { setTripArea } from '../lib/cities'
import { tripArea } from '../lib/home'
import { forPace } from '../lib/legs'
import type { Day, Item, Settings, Trip } from '../types'
import { useDays, useItems, useSettings, useTrip } from '../lib/hooks'
import { daysBetween, formatRange, today } from '../lib/dates'
import { plural } from '../lib/format'
import { Empty, toast } from '../components/ui'
import { TripDetailsModal } from './TripDetailsModal'

export interface TripCtx {
  trip: Trip
  items: Item[]
  days: Day[]
  settings: Settings
}

export const useTripCtx = () => useOutletContext<TripCtx>()

export function tripPhase(trip: Trip, on = today()) {
  if (on < trip.startDate) return { phase: 'before' as const, daysToGo: daysBetween(on, trip.startDate) }
  if (on > trip.endDate) return { phase: 'after' as const, daysToGo: 0 }
  return { phase: 'during' as const, daysToGo: 0, dayNo: daysBetween(trip.startDate, on) + 1 }
}

// `mobile` is the tab's place in the scrolling bottom bar (every tab is in it); the top tabs on a big screen use the list order.
const TABS = [
  { to: 'plan', label: 'Plan', emoji: '🗓️', mobile: 1 },
  { to: 'today', label: 'Day by day', emoji: '📍', mobile: 2 },
  { to: 'ideas', label: 'Ideas (AI)', emoji: '✨', mobile: 6 },
  { to: 'favorites', label: 'City planner', emoji: '🗺️', mobile: 3 },
  { to: 'checklist', label: 'Checklist', emoji: '✅', mobile: 4 },
  { to: 'budget', label: 'Budget', emoji: '💶', mobile: 5 },
  { to: 'essentials', label: 'Essentials', emoji: '🧭', mobile: 7 },
  { to: 'docs', label: 'Docs', emoji: '📄', mobile: 8 },
  { to: 'share', label: 'Share', emoji: '📤', mobile: 9 },
]
const MORE_TAB = { to: 'more', label: 'More', emoji: '⋯', mobile: 10 }

/**
 * The trip's sections. Once there's an itinerary, Ideas (AI) — mostly used to get it — moves into More (it stays a tab
 * while you're on it), so the tabs are what you use while planning and travelling.
 */
function tabsFor(hasPlan: boolean, pathname: string) {
  if (!hasPlan || /\/ideas$/.test(pathname)) return TABS
  return [...TABS.filter((t) => t.to !== 'ideas'), MORE_TAB]
}

/** The phone's bottom bar: all sections, scrolling sideways. The next tab peeks in and an arrow fades in while there is more. */
function BottomNav({ tabs }: { tabs: typeof TABS }) {
  const ref = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState({ left: false, right: true })
  const { pathname } = useLocation()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setMore({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 })
    update()
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  // Keep the current section in view (e.g. after opening Share from a link).
  useEffect(() => {
    const el = ref.current
    const a = el?.querySelector<HTMLElement>('a.active')
    if (el && a) el.scrollTo({ left: a.offsetLeft - (el.clientWidth - a.offsetWidth) / 2, behavior: 'smooth' })
  }, [pathname])

  const by = (dir: -1 | 1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.7, behavior: 'smooth' })
  return (
    <nav className="bottom-nav" aria-label="Sections">
      <div className="bottom-nav-scroll" ref={ref}>
        {[...tabs]
          .sort((a, b) => a.mobile - b.mobile)
          .map((t) => (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              <span>{t.emoji}</span>
              {t.label}
            </NavLink>
          ))}
      </div>
      {more.left && (
        <button className="nav-arrow left" aria-label="Scroll the menu left" onClick={() => by(-1)}>
          ‹
        </button>
      )}
      {more.right && (
        <button className="nav-arrow right" aria-label="More sections: scroll the menu right" onClick={() => by(1)}>
          ›
        </button>
      )}
    </nav>
  )
}

export default function TripLayout() {
  const { tripId } = useParams()
  const trip = useTrip(tripId)
  const items = useItems(tripId)
  const days = useDays(tripId)
  const base = useSettings()
  // Every page of the trip plans with the trip's pace in mind (all out walks further).
  const settings = useMemo(() => forPace(base, trip?.style), [base, trip?.style])
  // Place names are read with the trip's area in mind (Casablanca in Chile isn't the one in Morocco): set before the pages draw.
  useMemo(() => setTripArea(trip && days ? tripArea(trip, days) : []), [trip, days])
  const [editing, setEditing] = useState(false)
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // Whatever changed (a day's city, the trip's dates, an item moved or deleted, a replan, a sync from another device),
  // the wishlist and the plan are brought back in line a moment later. Nothing happens when they already agree.
  const favSig = useLiveQuery(
    async () => (tripId ? (await db.favorites.where('tripId').equals(tripId).toArray()).map((f) => `${f.id}:${f.date}:${f.itemId}:${f.city}`).join('|') : ''),
    [tripId],
  )
  const sig =
    trip && items && days && favSig !== undefined
      ? [trip.startDate, trip.endDate, days.map((d) => `${d.date}:${d.city}`).join(), items.map((i) => `${i.id}:${i.date}:${i.status}:${i.planner ?? ''}:${i.favId ?? ''}:${i.kind}`).join(), favSig].join('#')
      : ''
  // A safety stop: tidying up again and again within seconds means two rules disagree. Rather than let the screen redraw
  // forever, it pauses for a minute.
  const runs = useRef<number[]>([])
  useEffect(() => {
    if (!sig || !tripId) return
    const now = Date.now()
    runs.current = [...runs.current.filter((t) => now - t < 20_000), now]
    if (runs.current.length > 8) {
      console.warn('Trip tidy-up paused: it kept changing the plan')
      return
    }
    const t = setTimeout(async () => {
      const released = await reconcileTrip(tripId)
      if (released.length)
        toast(`${released.length === 1 ? released[0] : `${released.length} places`} went back to the backup ideas: ${released.length === 1 ? 'its day' : 'their days'} changed city or left the trip.`, {
          label: 'City planner',
          run: () => navigate(`/trip/${tripId}/favorites`),
        })
    }, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])

  if (trip === undefined || !items || !days) {
    // Still loading or deleted: Dexie returns undefined for both, so show a neutral state.
    return (
      <div className="page">
        <Empty emoji="🧭" title="Loading trip…" />
      </div>
    )
  }

  const ph = tripPhase(trip)
  const tabs = tabsFor(items.length > 0, pathname)
  const nights = daysBetween(trip.startDate, trip.endDate)

  return (
    <>
      <div className="trip-head">
        <div className="row between" style={{ marginBottom: 6 }}>
          <div className="row grow">
            <span className="trip-emoji">{trip.coverEmoji}</span>
            <div className="grow">
              <h1 style={{ fontSize: '1.25rem' }}>{trip.name}</h1>
              <div className="small muted">
                {formatRange(trip.startDate, trip.endDate)} · {plural(nights + 1, 'day')} ·{' '}
                {ph.phase === 'before' && <b style={{ color: 'var(--accent)' }}>{ph.daysToGo === 1 ? 'tomorrow!' : `in ${ph.daysToGo} days`}</b>}
                {ph.phase === 'during' && <b style={{ color: 'var(--primary)' }}>day {ph.dayNo} — on the road</b>}
                {ph.phase === 'after' && 'finished'}
              </div>
            </div>
          </div>
          <button className="btn-sm" onClick={() => setEditing(true)}>
            ✏️ <span className="hide-mobile">Trip details</span>
          </button>
        </div>
        <nav className="tabs top">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              {t.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="page">
        <Outlet context={{ trip, items, days, settings } satisfies TripCtx} />
      </div>
      <BottomNav tabs={tabs} />
      {editing && <TripDetailsModal trip={trip} onClose={() => setEditing(false)} />}
    </>
  )
}

export function TripIndex() {
  const { trip } = useTripCtx()
  const ph = tripPhase(trip)
  return <Navigate to={ph.phase === 'during' ? 'today' : 'plan'} replace />
}
