import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../db'
import type { Trip } from '../types'
import { addDays, dateRange, formatDate, today } from '../lib/dates'
import { country, countryLabel, flag } from '../lib/countries'
import { uid } from '../lib/ids'
import { plural } from '../lib/format'
import { useSettings } from '../lib/hooks'
import { BUDGET_LEVELS, ChipToggle, ChoiceGrid, CitiesInput, CountryPicker, INTERESTS, STYLES, TravellersEditor } from './TripFields'

const STEPS = ['Where', 'When', 'Who', 'What', 'Review']

export default function NewTripPage() {
  const settings = useSettings()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [days, setDays] = useState(7)
  const [t, setT] = useState<Trip>(() => ({
    id: uid(),
    name: '',
    countryCodes: [],
    cities: [],
    startDate: addDays(today(), 60),
    endDate: addDays(today(), 66),
    travellers: [{ id: uid(), name: 'Me', type: 'adult' }],
    style: 'balanced',
    budgetLevel: 'mid',
    interests: [],
    budget: {},
    coverEmoji: '🧳',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }))
  const set = <K extends keyof Trip>(k: K, v: Trip[K]) => setT((s) => ({ ...s, [k]: v }))

  const autoName = () => {
    const place = t.countryCodes.length ? t.countryCodes.map((c) => country(c)?.name ?? c).join(' & ') : t.cities[0] ?? 'New trip'
    const month = formatDate(t.startDate, { month: 'long', year: 'numeric' })
    return `${place} — ${month}`
  }

  async function create() {
    const endDate = addDays(t.startDate, days - 1)
    const trip: Trip = {
      ...t,
      endDate,
      name: t.name.trim() || autoName(),
      coverEmoji: t.coverEmoji === '🧳' && t.countryCodes.length === 1 ? flag(t.countryCodes[0]) : t.coverEmoji,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const cap = t.countryCodes.length === 1 && !t.cities.length ? country(t.countryCodes[0])?.capital : undefined
    await db.transaction('rw', [db.trips, db.days], async () => {
      await db.trips.add(trip)
      await db.days.bulkAdd(
        dateRange(trip.startDate, endDate).map((date) => ({
          id: `${trip.id}:${date}`,
          tripId: trip.id,
          date,
          city: cap?.name ?? (t.cities.length === 1 ? t.cities[0] : undefined),
          lat: cap?.lat,
          lon: cap?.lon,
        })),
      )
    })
    navigate(`/trip/${trip.id}/ideas`)
  }

  const canNext = step !== 0 || t.countryCodes.length > 0 || t.cities.length > 0 || !!t.notes

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div className="stack-lg">
        <div className="stack">
          <div className="steps">
            {STEPS.map((s, i) => (
              <div key={s} className={i <= step ? 'on' : ''} />
            ))}
          </div>
          <div className="small muted">
            Step {step + 1} of {STEPS.length} · {STEPS[step]}
          </div>
        </div>

        <div className="card stack">
          {step === 0 && (
            <>
              <h2>Where are you thinking of going?</h2>
              <p className="muted small">Pick one or more countries, and any places you already have in mind. Not sure? Leave it open and describe what you want.</p>
              <CountryPicker value={t.countryCodes} onChange={(v) => set('countryCodes', v)} />
              <label>
                Cities or regions (optional, comma separated)
                <CitiesInput value={t.cities} onChange={(v) => set('cities', v)} placeholder="e.g. Lisbon, Sintra, Porto" />
              </label>
              <label>
                Or describe it
                <textarea
                  style={{ minHeight: 70 }}
                  value={t.notes ?? ''}
                  onChange={(e) => set('notes', e.target.value)}
                  placeholder="e.g. Somewhere warm in Europe in October, with beaches and easy train travel"
                />
              </label>
            </>
          )}

          {step === 1 && (
            <>
              <h2>When, and for how long?</h2>
              <div className="form-grid">
                <label>
                  First day
                  <input type="date" value={t.startDate} onChange={(e) => set('startDate', e.target.value)} />
                </label>
                <label>
                  Number of days
                  <input type="number" min={1} max={90} value={days} onChange={(e) => setDays(Math.max(1, Number(e.target.value)))} />
                </label>
              </div>
              <div className="chips">
                {[3, 5, 7, 10, 14, 21].map((n) => (
                  <button key={n} type="button" className={`chip ${days === n ? 'on' : ''}`} onClick={() => setDays(n)}>
                    {n} days
                  </button>
                ))}
              </div>
              <p className="small muted">You can change dates later — the plan follows.</p>
            </>
          )}

          {step === 2 && (
            <>
              <h2>Who's coming?</h2>
              <p className="muted small">Children's ages help suggest a realistic pace and the right activities.</p>
              <TravellersEditor value={t.travellers} onChange={(v) => set('travellers', v)} />
            </>
          )}

          {step === 3 && (
            <>
              <h2>What kind of trip?</h2>
              <label>Pace</label>
              <ChoiceGrid options={STYLES} value={t.style} onChange={(v) => set('style', v)} />
              <label>Budget</label>
              <ChoiceGrid options={BUDGET_LEVELS} value={t.budgetLevel} onChange={(v) => set('budgetLevel', v)} />
              <label>What do you enjoy?</label>
              <ChipToggle options={INTERESTS} value={t.interests} onChange={(v) => set('interests', v)} />
            </>
          )}

          {step === 4 && (
            <>
              <h2>Ready to plan</h2>
              <label>
                Trip name
                <input value={t.name} placeholder={autoName()} onChange={(e) => set('name', e.target.value)} />
              </label>
              <div className="info-grid">
                <Tile k="Where" v={[...t.countryCodes.map(countryLabel), ...t.cities].join(', ') || 'Open'} />
                <Tile k="When" v={`${formatDate(t.startDate)} · ${days} days`} />
                <Tile k="Who" v={`${plural(t.travellers.filter((x) => x.type === 'adult').length, 'adult')}, ${plural(t.travellers.filter((x) => x.type === 'child').length, 'child', 'children')}`} />
                <Tile k="Style" v={`${STYLES[t.style].label} · ${BUDGET_LEVELS[t.budgetLevel].label}`} />
              </div>
              {t.interests.length > 0 && <p className="small">Interests: {t.interests.join(', ')}</p>}
              <p className="small muted">
                Next you'll get itinerary ideas (via a free chatbot, or a quick template), then a budget and a checklist.
                {!settings.nationality && ' Tip: set your nationality in Settings for visa and plug advice.'}
              </p>
            </>
          )}
        </div>

        <div className="row between">
          <button onClick={() => (step ? setStep(step - 1) : navigate('/'))}>{step ? '← Back' : 'Cancel'}</button>
          {step < STEPS.length - 1 ? (
            <button className="btn-primary" disabled={!canNext} onClick={() => setStep(step + 1)}>
              Next →
            </button>
          ) : (
            <button className="btn-primary" onClick={create}>
              Create trip ✨
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Tile({ k, v }: { k: string; v: string }) {
  return (
    <div className="info-tile">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  )
}
