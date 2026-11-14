import { useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { createDemoTrip } from '../lib/sample'
import { importAny } from '../lib/share'
import { formatRange } from '../lib/dates'
import { countryLabel } from '../lib/countries'
import { useSettings } from '../lib/hooks'
import { Empty, toast } from '../components/ui'
import { tripPhase } from './TripLayout'
import type { Trip } from '../types'

export default function HomePage() {
  const trips = useLiveQuery(() => db.trips.orderBy('startDate').toArray(), [])
  const settings = useSettings()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)

  if (!trips) return <div className="page" />

  const current = trips.filter((t) => tripPhase(t).phase === 'during')
  const upcoming = trips.filter((t) => tripPhase(t).phase === 'before')
  const past = trips.filter((t) => tripPhase(t).phase === 'after').reverse()

  async function demo() {
    const id = await createDemoTrip()
    toast('Demo trip created')
    navigate(`/trip/${id}/today`)
  }

  async function onImport(file: File) {
    try {
      const ids = await importAny(await file.text())
      toast(`Imported ${ids.length} trip${ids.length > 1 ? 's' : ''}`)
      if (ids.length === 1) navigate(`/trip/${ids[0]}`)
    } catch (e) {
      toast((e as Error).message || 'Could not read that file')
    }
  }

  return (
    <div className="page stack-lg">
      {current.map((t) => (
        <Link key={t.id} to={`/trip/${t.id}/today`} className="card hero trip-card">
          <div className="row">
            <span className="trip-emoji">{t.coverEmoji}</span>
            <div className="grow">
              <div className="small muted">You're travelling · day {tripPhase(t).dayNo}</div>
              <h2>{t.name}</h2>
            </div>
            <span className="btn">Open day by day →</span>
          </div>
        </Link>
      ))}

      {!settings.nationality && (
        <div className="notice info row wrap between">
          <span>Set your nationality and home currency so checklists (visas, plugs, roaming) and budgets fit you.</span>
          <Link to="/settings" className="btn btn-sm">
            Settings
          </Link>
        </div>
      )}

      <div className="row wrap between">
        <h1>Your trips</h1>
        <div className="row wrap">
          <button onClick={() => fileRef.current?.click()}>📥 Import</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
          <button onClick={demo}>🇵🇹 Demo trip</button>
          <Link to="/new" className="btn btn-primary">
            + Plan a new trip
          </Link>
        </div>
      </div>

      {trips.length === 0 && (
        <div className="card">
          <Empty emoji="🧭" title="No trips yet">
            <p style={{ maxWidth: 460, margin: '0 auto 14px' }}>
              Answer a few questions to get itinerary ideas, a budget and a checklist — or load the demo trip to see what the app does while you travel.
            </p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button onClick={demo}>Load the demo trip</button>
              <Link to="/new" className="btn btn-primary">
                Plan a trip
              </Link>
            </div>
          </Empty>
        </div>
      )}

      <TripGroup title="Coming up" trips={upcoming} />
      <TripGroup title="Past trips" trips={past} />
    </div>
  )
}

function TripGroup({ title, trips }: { title: string; trips: Trip[] }) {
  if (!trips.length) return null
  return (
    <section className="stack">
      <h2 className="muted" style={{ fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {title}
      </h2>
      <div className="grid-3">
        {trips.map((t) => {
          const ph = tripPhase(t)
          return (
            <Link key={t.id} to={`/trip/${t.id}`} className="card trip-card stack" style={{ gap: 6 }}>
              <div className="row between">
                <span className="trip-emoji">{t.coverEmoji}</span>
                {ph.phase === 'before' && <span className="badge planned">in {ph.daysToGo} days</span>}
              </div>
              <h3>{t.name}</h3>
              <div className="small muted">{formatRange(t.startDate, t.endDate)}</div>
              <div className="small">{t.countryCodes.map(countryLabel).join(' · ') || t.cities.join(' · ')}</div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
