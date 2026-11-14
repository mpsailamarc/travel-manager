import { useEffect, useRef, useState } from 'react'
import { Navigate, NavLink, Outlet, useLocation, useOutletContext, useParams } from 'react-router-dom'
import type { Day, Item, Settings, Trip } from '../types'
import { useDays, useItems, useSettings, useTrip } from '../lib/hooks'
import { daysBetween, formatRange, today } from '../lib/dates'
import { plural } from '../lib/format'
import { Empty } from '../components/ui'
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
  { to: 'favorites', label: 'Favourites', emoji: '⭐', mobile: 3 },
  { to: 'checklist', label: 'Checklist', emoji: '✅', mobile: 4 },
  { to: 'budget', label: 'Budget', emoji: '💶', mobile: 5 },
  { to: 'essentials', label: 'Essentials', emoji: '🧭', mobile: 7 },
  { to: 'walk', label: 'Walks', emoji: '🚶', mobile: 8 },
  { to: 'docs', label: 'Docs', emoji: '📄', mobile: 9 },
  { to: 'share', label: 'Share', emoji: '📤', mobile: 10 },
]

/** The phone's bottom bar: all sections, scrolling sideways. The next tab peeks in and an arrow fades in while there is more. */
function BottomNav() {
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
        {[...TABS]
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
  const settings = useSettings()
  const [editing, setEditing] = useState(false)

  if (trip === undefined || !items || !days) {
    // Still loading or deleted: Dexie returns undefined for both, so show a neutral state.
    return (
      <div className="page">
        <Empty emoji="🧭" title="Loading trip…" />
      </div>
    )
  }

  const ph = tripPhase(trip)
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
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              {t.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="page">
        <Outlet context={{ trip, items, days, settings } satisfies TripCtx} />
      </div>
      <BottomNav />
      {editing && <TripDetailsModal trip={trip} onClose={() => setEditing(false)} />}
    </>
  )
}

export function TripIndex() {
  const { trip } = useTripCtx()
  const ph = tripPhase(trip)
  return <Navigate to={ph.phase === 'during' ? 'today' : 'plan'} replace />
}
