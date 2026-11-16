import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../db'
import type { Trip } from '../types'
import { addDays, dateRange, formatDate, today } from '../lib/dates'
import { country, countryLabel, flag } from '../lib/countries'
import { uid } from '../lib/ids'
import { locatePlace } from '../lib/apis'
import { t as tr, tn } from '../i18n'
import { useSettings } from '../lib/hooks'
import { BUDGET_LEVELS, ChipToggle, ChoiceGrid, DestinationInput, FOCUS, INNER_FLIGHTS, INTERESTS, RouteFields, StartEndFields, STYLES, TravellersEditor } from './TripFields'

const STEPS = [tr('Where'), tr('When'), tr('Who'), tr('What'), tr('Review')]

export default function NewTripPage() {
  const settings = useSettings()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [days, setDays] = useState(7)
  const [creating, setCreating] = useState(false)
  const [t, setT] = useState<Trip>(() => ({
    id: uid(),
    name: '',
    countryCodes: [],
    cities: [],
    startDate: addDays(today(), 60),
    endDate: addDays(today(), 66),
    travellers: [{ id: uid(), name: tr('Me'), type: 'adult' }],
    style: 'balanced',
    budgetLevel: 'mid',
    interests: [],
    budget: {},
    coverEmoji: '🧳',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }))
  const set = <K extends keyof Trip>(k: K, v: Trip[K]) => setT((s) => ({ ...s, [k]: v }))

  // Where you start: home from Settings (city or usual airport), filled in once Settings have loaded — change it for this trip.
  const startTouched = useRef(false)
  useEffect(() => {
    if (!startTouched.current && settings.homeAirport && !t.startPlace?.name) setT((s) => ({ ...s, startPlace: { name: settings.homeAirport! } }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.homeAirport])
  const fromHome = !!settings.homeAirport && t.startPlace?.name === settings.homeAirport

  const autoName = () => {
    const place = t.countryCodes.length ? t.countryCodes.map((c) => country(c)?.name ?? c).join(' & ') : t.cities[0] ?? tr('New trip')
    const month = formatDate(t.startDate, { month: 'long', year: 'numeric' })
    return `${place} — ${month}`
  }

  async function create() {
    if (creating) return // looking up the start place can take a moment: a second tap must not create a second trip
    setCreating(true)
    const endDate = addDays(t.startDate, days - 1)
    const trip: Trip = {
      ...t,
      endDate,
      name: t.name.trim() || autoName(),
      coverEmoji: t.coverEmoji === '🧳' && t.countryCodes.length === 1 ? flag(t.countryCodes[0]) : t.coverEmoji,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    // Nothing typed for the start: it's home (Settings → Home city or usual airport), when that is set.
    trip.startPlace = await locatePlace(t.startPlace?.name?.trim() ? t.startPlace : settings.homeAirport ? { name: settings.homeAirport } : undefined)
    trip.endPlace = t.endPlace?.name ? await locatePlace(t.endPlace) : undefined
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
            {tr('Step {n} of {total} · {name}', { n: step + 1, total: STEPS.length, name: STEPS[step] })}
          </div>
        </div>

        <div className="card stack">
          {step === 0 && (
            <>
              <h2>{tr('Where are you thinking of going?')}</h2>
              <label>
                {tr('Trip name')}
                <input value={t.name} placeholder={autoName()} onChange={(e) => set('name', e.target.value)} />
              </label>
              <label>{tr('Where to')}</label>
              <DestinationInput cities={t.cities} countryCodes={t.countryCodes} onChange={(v) => setT((s) => ({ ...s, ...v }))} />
              <StartEndFields
                value={t}
                onChange={(v) => {
                  startTouched.current = true
                  setT((s) => ({ ...s, ...v }))
                }}
                hint={fromHome ? tr('Your home, from Settings. Change it if this trip starts somewhere else.') : settings.homeAirport ? undefined : tr('Tip: set your home city in Settings and new trips start from there.')}
              />
              <label>
                {tr('Or describe it')}
                <textarea
                  style={{ minHeight: 70 }}
                  value={t.notes ?? ''}
                  onChange={(e) => set('notes', e.target.value)}
                  placeholder={tr('e.g. Somewhere warm in Europe in October, with beaches and easy train travel')}
                />
              </label>
            </>
          )}

          {step === 1 && (
            <>
              <h2>{tr('When, and for how long?')}</h2>
              <div className="form-grid">
                <label>
                  {tr('First day there (you land)')}
                  <input type="date" value={t.startDate} onChange={(e) => set('startDate', e.target.value)} />
                </label>
                <label>
                  {tr('Days there')}
                  <input type="number" min={1} max={90} value={days} onChange={(e) => setDays(Math.max(1, Number(e.target.value)))} />
                </label>
              </div>
              <div className="chips">
                {[3, 5, 7, 10, 14, 21].map((n) => (
                  <button key={n} type="button" className={`chip ${days === n ? 'on' : ''}`} onClick={() => setDays(n)}>
                    {tr('{n} days', { n })}
                  </button>
                ))}
              </div>
              <p className="small muted">
                {tr("The trip's days are the days at the destination: from the day you land there to the day you fly out. 14 days in Chile is 14 days, however long the flights from home take (the flight out may leave the day before; the flight home lands after the last day).")}
              </p>
              <p className="small muted">
                {tr('Last day there (you fly out):')} <b>{formatDate(addDays(t.startDate, days - 1))}</b>. {tr('You can change dates later — the plan follows.')}
              </p>
            </>
          )}

          {step === 2 && (
            <>
              <h2>{tr("Who's coming?")}</h2>
              <p className="muted small">{tr("Children's ages help suggest a realistic pace and the right activities.")}</p>
              <TravellersEditor value={t.travellers} onChange={(v) => set('travellers', v)} />
            </>
          )}

          {step === 3 && (
            <>
              <h2>{tr('What kind of trip?')}</h2>
              <label>{tr('Pace')}</label>
              <ChoiceGrid options={STYLES} value={t.style} onChange={(v) => set('style', v)} />
              <label>{tr('Budget')}</label>
              <ChoiceGrid options={BUDGET_LEVELS} value={t.budgetLevel} onChange={(v) => set('budgetLevel', v)} />
              <RouteFields value={t} onChange={(v) => setT((s) => ({ ...s, ...v }))} />
              <label>{tr('What do you enjoy?')}</label>
              <ChipToggle options={INTERESTS} value={t.interests} onChange={(v) => set('interests', v)} />
            </>
          )}

          {step === 4 && (
            <>
              <h2>{tr('Ready to plan')}</h2>
              <div className="info-grid">
                <Tile k={tr('Name')} v={t.name.trim() || autoName()} />
                <Tile k={tr('Where')} v={[...t.countryCodes.map(countryLabel), ...t.cities].join(', ') || tr('Open')} />
                <Tile k={tr('When')} v={tr('{from} → {to} · {n} days there', { from: formatDate(t.startDate), to: formatDate(addDays(t.startDate, days - 1)), n: days })} />
                <Tile k={tr('Who')} v={`${tn(t.travellers.filter((x) => x.type === 'adult').length, '{n} adult', '{n} adults')}, ${tn(t.travellers.filter((x) => x.type === 'child').length, '{n} child', '{n} children')}`} />
                <Tile k={tr('Style')} v={`${STYLES[t.style].label} · ${BUDGET_LEVELS[t.budgetLevel].label}`} />
                <Tile k={tr('Route')} v={`${FOCUS[t.focus ?? 'mix'].label} · ${INNER_FLIGHTS[t.innerFlights ?? 'auto'].label}`} />
              </div>
              {t.interests.length > 0 && <p className="small">{tr('Interests: {list}', { list: t.interests.map((i) => tr(i)).join(', ') })}</p>}
              <p className="small muted">
                {tr("Next you'll get itinerary ideas (via a free chatbot, or a quick template), then a budget and a checklist.")}
                {!settings.nationality && ' ' + tr('Tip: set your nationality in Settings for visa and plug advice.')}
              </p>
            </>
          )}
        </div>

        <div className="row between">
          <button onClick={() => (step ? setStep(step - 1) : navigate('/'))}>{step ? tr('← Back') : tr('Cancel')}</button>
          {step < STEPS.length - 1 ? (
            <button className="btn-primary" disabled={!canNext} onClick={() => setStep(step + 1)}>
              {tr('Next →')}
            </button>
          ) : (
            <button className="btn-primary" onClick={create} disabled={creating}>
              {creating ? tr('Creating…') : tr('Create trip ✨')}
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
