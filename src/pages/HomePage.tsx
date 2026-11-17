import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, deleteTrip } from '../db'
import { createDemoTrip } from '../lib/sample'
import { duplicateTrip, exportTrip, importAny, shareOrDownload } from '../lib/share'
import { formatRange } from '../lib/dates'
import { countryLabel } from '../lib/countries'
import { useSettings } from '../lib/hooks'
import { Empty, toast } from '../components/ui'
import { t, tn } from '../i18n'
import { tripPhase } from './TripLayout'
import { clearDraft, readDraft } from './NewTripPage'
import { STEPS_LABELS } from './NewTripPage'
import type { Trip } from '../types'

export default function HomePage() {
  const trips = useLiveQuery(() => db.trips.orderBy('startDate').toArray(), [])
  const settings = useSettings()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(readDraft)
  // Trips with nothing in the plan yet: work in progress, opened at the itinerary ideas.
  const planned = useLiveQuery(async () => new Set((await db.items.orderBy('tripId').uniqueKeys()) as string[]), [])

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
      {!settings.nationality && (
        <div className="notice info row wrap between">
          <span>{t('Set your nationality and home currency so checklists (visas, plugs, roaming) and budgets fit you.')}</span>
          <Link to="/settings" className="btn btn-sm">
            {t('Settings')}
          </Link>
        </div>
      )}

      <div className="stack" style={{ gap: 6 }}>
        <div className="row wrap between">
          <h1>{t('Your trips')}</h1>
          <div className="row wrap">
            <Link to="/new" className="btn btn-primary">
              {t('+ Plan a new trip')}
            </Link>
            <button onClick={() => fileRef.current?.click()} title={t('Add a trip from a file: one sent to you, or one you exported')}>
              {t('📥 Import a trip file')}
            </button>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
          </div>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {t('“Import a trip file” adds a trip from a .trip.json file (one a friend sent you with Share, or one you saved with Export on a trip below) or from a full backup. It becomes a new trip; nothing you have is replaced.')}
        </p>
      </div>

      {trips.length === 0 && (
        <div className="card">
          <Empty emoji="🧭" title={t('No trips yet')}>
            <p style={{ maxWidth: 460, margin: '0 auto 14px' }}>{t('Answer a few questions to get itinerary ideas, a budget and a checklist.')}</p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <Link to="/new" className="btn btn-primary">
                {t('Plan a trip')}
              </Link>
            </div>
          </Empty>
        </div>
      )}

      {draft && (
        <div className="card row wrap between" style={{ borderStyle: 'dashed' }}>
          <div>
            <div className="row" style={{ gap: 8 }}>
              <span className="badge planned">{t('🚧 WIP')}</span>
              <b>{draft.t.name.trim() || [...draft.t.countryCodes.map(countryLabel), ...draft.t.cities].join(', ') || t('New trip')}</b>
            </div>
            <div className="small muted">{t('Trip not created yet · step {n} of 5 · {name}', { n: draft.step + 1, name: STEPS_LABELS[draft.step] })}</div>
          </div>
          <div className="row">
            <Link to="/new?resume=1" className="btn btn-primary btn-sm">
              {t('Continue')}
            </Link>
            <button
              className="btn-sm btn-ghost"
              onClick={() => {
                if (!confirm(t('Discard this unfinished trip?'))) return
                clearDraft()
                setDraft(undefined)
              }}
            >
              {t('Discard')}
            </button>
          </div>
        </div>
      )}
      <TripGroup title={t('Travelling now')} trips={current} planned={planned} />
      <TripGroup title={t('Coming up')} trips={upcoming} planned={planned} />
      <TripGroup title={t('Past trips')} trips={past} planned={planned} />

      <section className="stack">
        <h2 className="muted" style={{ fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {t('Demo')}
        </h2>
        <div className="card row wrap between">
          <div style={{ maxWidth: 520 }}>
            <b>{t('🇵🇹 Demo trip')}</b>
            <div className="small muted">{t('A made-up trip to Portugal, to see what the app does. It is a trip like any other: remove it when you are done.')}</div>
          </div>
          <button onClick={demo}>{t('Load the demo trip')}</button>
        </div>
      </section>
    </div>
  )
}

function TripGroup({ title, trips, planned }: { title: string; trips: Trip[]; planned?: Set<string> }) {
  const navigate = useNavigate()
  // A copy to try things on (other dates, cities, pace), the original untouched — the same as in Trip details.
  async function duplicate(tp: Trip) {
    const name = prompt(t('Name of the copy'), t('{name} (copy)', { name: tp.name }))
    if (!name?.trim()) return
    const id = await duplicateTrip(tp.id, name.trim())
    toast(t('📄 “{name}” created: a copy to try things on, the original is unchanged', { name: name.trim() }))
    navigate(`/trip/${id}/plan`)
  }
  async function exportIt(tp: Trip) {
    const file = await exportTrip(tp.id, { documents: false, expenses: true })
    const how = await shareOrDownload(file)
    if (how === 'downloaded') toast(t('Saved {name}', { name: file.name }))
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
          const wip = !!planned && !planned.has(tp.id) // nothing planned yet: opens at the itinerary ideas
          return (
            <Link key={tp.id} to={`/trip/${tp.id}${wip ? '/ideas' : ''}`} className="card trip-card stack" style={{ gap: 6 }}>
              <div className="row between">
                <span className="trip-emoji">{tp.coverEmoji}</span>
                <span className="row" style={{ gap: 6 }}>
                  {wip && <span className="badge planned" title={t('The itinerary is not set up yet: open it to carry on')}>{t('🚧 WIP')}</span>}
                  {ph.phase === 'before' && <span className="badge planned">{tn(ph.daysToGo, 'in {n} day', 'in {n} days')}</span>}
                </span>
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
                  title={t('Save this trip as a file (.trip.json), to back it up or send it')}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    void exportIt(tp)
                  }}
                >
                  {t('📤 Export')}
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
