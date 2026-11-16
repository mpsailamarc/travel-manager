import { useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, deleteTrip } from '../db'
import { createDemoTrip } from '../lib/sample'
import { duplicateTrip, importAny } from '../lib/share'
import { formatRange } from '../lib/dates'
import { countryLabel } from '../lib/countries'
import { useSettings } from '../lib/hooks'
import { Empty, toast } from '../components/ui'
import { t, tn } from '../i18n'
import { tripPhase } from './TripLayout'
import type { Trip } from '../types'

export default function HomePage() {
  const trips = useLiveQuery(() => db.trips.orderBy('startDate').toArray(), [])
  const settings = useSettings()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)

  if (!trips) return <div className="page" />

  const current = trips.filter((x) => tripPhase(x).phase === 'during')
  const upcoming = trips.filter((x) => tripPhase(x).phase === 'before')
  const past = trips.filter((x) => tripPhase(x).phase === 'after').reverse()

  async function demo() {
    const id = await createDemoTrip()
    toast(t('Demo trip created'))
    navigate(`/trip/${id}/today`)
  }

  async function onImport(file: File) {
    try {
      const ids = await importAny(await file.text())
      toast(tn(ids.length, 'Imported {n} trip', 'Imported {n} trips'))
      if (ids.length === 1) navigate(`/trip/${ids[0]}`)
    } catch (e) {
      toast((e as Error).message || t('Could not read that file'))
    }
  }

  return (
    <div className="page stack-lg">
      {current.map((c) => (
        <Link key={c.id} to={`/trip/${c.id}/today`} className="card hero trip-card">
          <div className="row">
            <span className="trip-emoji">{c.coverEmoji}</span>
            <div className="grow">
              <div className="small muted">{t("You're travelling · day {n}", { n: tripPhase(c).dayNo ?? '' })}</div>
              <h2>{c.name}</h2>
            </div>
            <span className="btn">{t('Open day by day →')}</span>
          </div>
        </Link>
      ))}

      {!settings.nationality && (
        <div className="notice info row wrap between">
          <span>{t('Set your nationality and home currency so checklists (visas, plugs, roaming) and budgets fit you.')}</span>
          <Link to="/settings" className="btn btn-sm">
            {t('Settings')}
          </Link>
        </div>
      )}

      <div className="row wrap between">
        <h1>{t('Your trips')}</h1>
        <div className="row wrap">
          <button onClick={() => fileRef.current?.click()}>{t('📥 Import')}</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
          <button onClick={demo}>{t('🇵🇹 Demo trip')}</button>
          <Link to="/new" className="btn btn-primary">
            {t('+ Plan a new trip')}
          </Link>
        </div>
      </div>

      {trips.length === 0 && (
        <div className="card">
          <Empty emoji="🧭" title={t('No trips yet')}>
            <p style={{ maxWidth: 460, margin: '0 auto 14px' }}>
              {t('Answer a few questions to get itinerary ideas, a budget and a checklist — or load the demo trip to see what the app does while you travel.')}
            </p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button onClick={demo}>{t('Load the demo trip')}</button>
              <Link to="/new" className="btn btn-primary">
                {t('Plan a trip')}
              </Link>
            </div>
          </Empty>
        </div>
      )}

      <TripGroup title={t('Coming up')} trips={upcoming} />
      <TripGroup title={t('Past trips')} trips={past} />
    </div>
  )
}

function TripGroup({ title, trips }: { title: string; trips: Trip[] }) {
  const navigate = useNavigate()
  // A copy to try things on (other dates, cities, pace), the original untouched — the same as in Trip details.
  async function duplicate(tp: Trip) {
    const name = prompt(t('Name of the copy'), t('{name} (copy)', { name: tp.name }))
    if (!name?.trim()) return
    const id = await duplicateTrip(tp.id, name.trim())
    toast(t('📄 “{name}” created: a copy to try things on, the original is unchanged', { name: name.trim() }))
    navigate(`/trip/${id}/plan`)
  }
  async function remove(tp: Trip) {
    if (!confirm(t('Remove "{name}" and everything in it (plan, checklist, expenses, documents)? This can\'t be undone.', { name: tp.name }))) return
    await deleteTrip(tp.id)
    toast(t('🗑️ “{name}” removed', { name: tp.name }))
  }
  if (!trips.length) return null
  return (
    <section className="stack">
      <h2 className="muted" style={{ fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {title}
      </h2>
      <div className="grid-3">
        {trips.map((tp) => {
          const ph = tripPhase(tp)
          return (
            <Link key={tp.id} to={`/trip/${tp.id}`} className="card trip-card stack" style={{ gap: 6 }}>
              <div className="row between">
                <span className="trip-emoji">{tp.coverEmoji}</span>
                {ph.phase === 'before' && <span className="badge planned">{tn(ph.daysToGo, 'in {n} day', 'in {n} days')}</span>}
              </div>
              <h3>{tp.name}</h3>
              <div className="small muted">{formatRange(tp.startDate, tp.endDate)}</div>
              <div className="small">{tp.countryCodes.map(countryLabel).join(' · ') || tp.cities.join(' · ')}</div>
              <div>
                <button
                  type="button"
                  className="btn-sm btn-ghost"
                  title={t('A copy of this trip to try other dates, cities or pace')}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    void duplicate(tp)
                  }}
                >
                  {t('📄 Duplicate')}
                </button>{' '}
                <button
                  type="button"
                  className="btn-sm btn-ghost"
                  title={t('Delete this trip and everything in it')}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    void remove(tp)
                  }}
                >
                  {t('🗑️ Remove')}
                </button>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
