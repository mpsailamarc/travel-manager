import { useState } from 'react'
import { Navigate, NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom'
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

const TABS = [
  { to: 'today', label: 'Today', emoji: '📍', mobile: true },
  { to: 'plan', label: 'Plan', emoji: '🗓️', mobile: true },
  { to: 'ideas', label: 'Ideas (AI)', emoji: '✨' },
  { to: 'favorites', label: 'Favourites', emoji: '⭐', mobile: true },
  { to: 'checklist', label: 'Checklist', emoji: '✅', mobile: true },
  { to: 'budget', label: 'Budget', emoji: '💶', mobile: true },
  { to: 'essentials', label: 'Essentials', emoji: '🧭' },
  { to: 'walk', label: 'Walks', emoji: '🚶' },
  { to: 'docs', label: 'Docs', emoji: '📄' },
  { to: 'share', label: 'Share', emoji: '📤' },
]

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
      <nav className="bottom-nav">
        {TABS.filter((t) => t.mobile).map((t) => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? 'active' : '')}>
            <span>{t.emoji}</span>
            {t.label}
          </NavLink>
        ))}
        <NavLink to="more" className={({ isActive }) => (isActive ? 'active' : '')}>
          <span>☰</span>
          More
        </NavLink>
      </nav>
      {editing && <TripDetailsModal trip={trip} onClose={() => setEditing(false)} />}
    </>
  )
}

export function TripIndex() {
  const { trip } = useTripCtx()
  const ph = tripPhase(trip)
  return <Navigate to={ph.phase === 'during' ? 'today' : 'plan'} replace />
}
