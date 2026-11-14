import { useState } from 'react'
import type { BudgetLevel, Traveller, Trip, TripStyle } from '../types'
import { COUNTRIES, countryLabel, flag } from '../lib/countries'
import { uid } from '../lib/ids'
import { PlaceSearch } from '../components/PlaceSearch'

export const INTERESTS = [
  'history', 'museums', 'architecture', 'food', 'markets', 'nature', 'hiking', 'beaches', 'wildlife', 'art',
  'viewpoints', 'local culture', 'nightlife', 'shopping', 'theme parks', 'aquariums', 'photography', 'wellness', 'wine', 'road trip',
]

export const STYLES: Record<TripStyle, { label: string; desc: string }> = {
  relaxed: { label: '🐢 Relaxed', desc: '1–2 things a day, lots of downtime' },
  balanced: { label: '🚶 Balanced', desc: 'A plan each day with breaks' },
  packed: { label: '🏃 Packed', desc: 'See as much as possible' },
}

export const BUDGET_LEVELS: Record<BudgetLevel, { label: string; desc: string }> = {
  shoestring: { label: '🎒 Shoestring', desc: 'Hostels, street food, public transport' },
  mid: { label: '🏨 Mid-range', desc: '3★ hotels, nice restaurants sometimes' },
  comfort: { label: '🛎️ Comfort', desc: '4★ hotels, taxis when useful' },
  luxury: { label: '💎 Luxury', desc: 'The best of everything' },
}

export const EMOJIS = ['🧳', '🏖️', '🏔️', '🏙️', '🏛️', '🌴', '🗺️', '🚂', '⛩️', '🏝️', '🎒', '🐘', '❄️', '🍝', '🍣', '🌋']

export function CountryPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState('')
  const matches = q ? COUNTRIES.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) && !value.includes(c.code)).slice(0, 8) : []
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="chips">
        {value.map((c) => (
          <button key={c} type="button" className="chip on" onClick={() => onChange(value.filter((x) => x !== c))}>
            {countryLabel(c)} ✕
          </button>
        ))}
      </div>
      <input placeholder="Type a country…" value={q} onChange={(e) => setQ(e.target.value)} />
      {matches.length > 0 && (
        <div className="chips">
          {matches.map((c) => (
            <button
              key={c.code}
              type="button"
              className="chip"
              onClick={() => {
                onChange([...value, c.code])
                setQ('')
              }}
            >
              {flag(c.code)} {c.name}
            </button>
          ))}
        </div>
      )}
      {q && !matches.length && <span className="tiny muted">Not in the built-in list — add it as a place name below instead.</span>}
    </div>
  )
}

/** Keeps the raw text while typing so commas and spaces aren't swallowed. */
export function CitiesInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState(value.join(', '))
  return (
    <input
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value)
        onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))
      }}
    />
  )
}

/** Where the trip starts and ends (often the same place): drawn on the map and told to the AI. */
export function StartEndFields({ value, onChange }: { value: Pick<Trip, 'startPlace' | 'endPlace'>; onChange: (v: Pick<Trip, 'startPlace' | 'endPlace'>) => void }) {
  const sameEnd = !value.endPlace
  return (
    <div className="stack" style={{ gap: 8 }}>
      <PlaceSearch label="Starting from (optional)" value={value.startPlace} onChange={(p) => onChange({ ...value, startPlace: p })} placeholder="e.g. San Francisco" />
      {value.startPlace && (
        <>
          <label className="inline small">
            <input
              type="checkbox"
              checked={sameEnd}
              onChange={(e) => onChange({ ...value, endPlace: e.target.checked ? undefined : { name: value.startPlace?.name ?? '' } })}
            />{' '}
            Return to the same place
          </label>
          {!sameEnd && <PlaceSearch label="Returning to" value={value.endPlace} onChange={(p) => onChange({ ...value, endPlace: p ?? { name: '' } })} placeholder="e.g. Los Angeles" />}
          <p className="tiny muted">Tap “Find” so it appears on the map. Starting in the same country as your destination also means no flights in the budget estimate.</p>
        </>
      )}
    </div>
  )
}

export function TravellersEditor({ value, onChange }: { value: Traveller[]; onChange: (v: Traveller[]) => void }) {
  const update = (id: string, patch: Partial<Traveller>) => onChange(value.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  return (
    <div className="stack" style={{ gap: 8 }}>
      {value.map((t) => (
        <div key={t.id} className="row">
          <span style={{ fontSize: '1.3rem' }}>{t.type === 'adult' ? '🧑' : '🧒'}</span>
          <input className="grow" value={t.name} onChange={(e) => update(t.id, { name: e.target.value })} />
          {t.type === 'child' && (
            <input
              type="number"
              min={0}
              max={17}
              style={{ width: 80 }}
              placeholder="Age"
              value={t.age ?? ''}
              onChange={(e) => update(t.id, { age: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
          )}
          <button type="button" className="icon-btn" onClick={() => onChange(value.filter((x) => x.id !== t.id))} aria-label="Remove">
            ✕
          </button>
        </div>
      ))}
      <div className="row">
        <button type="button" className="btn-sm" onClick={() => onChange([...value, { id: uid(), type: 'adult', name: `Adult ${value.filter((v) => v.type === 'adult').length + 1}` }])}>
          + Adult
        </button>
        <button type="button" className="btn-sm" onClick={() => onChange([...value, { id: uid(), type: 'child', name: `Child ${value.filter((v) => v.type === 'child').length + 1}`, age: 8 }])}>
          + Child
        </button>
      </div>
    </div>
  )
}

export function ChipToggle({ options, value, onChange }: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          className={`chip ${value.includes(o) ? 'on' : ''}`}
          onClick={() => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o])}
        >
          {o}
        </button>
      ))}
    </div>
  )
}

export function ChoiceGrid<K extends string>({ options, value, onChange }: { options: Record<K, { label: string; desc: string }>; value: K; onChange: (k: K) => void }) {
  return (
    <div className="choice-grid">
      {(Object.keys(options) as K[]).map((k) => (
        <button key={k} type="button" className={`choice ${value === k ? 'on' : ''}`} onClick={() => onChange(k)}>
          <b>{options[k].label}</b>
          <span className="tiny muted">{options[k].desc}</span>
        </button>
      ))}
    </div>
  )
}

export function TripFields({ value: t, onChange }: { value: Trip; onChange: (t: Trip) => void }) {
  const set = <K extends keyof Trip>(k: K, v: Trip[K]) => onChange({ ...t, [k]: v })
  return (
    <div className="stack">
      <div className="form-grid">
        <label className="full">
          Name
          <input value={t.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label>
          Start
          <input type="date" value={t.startDate} onChange={(e) => set('startDate', e.target.value)} />
        </label>
        <label>
          End
          <input type="date" value={t.endDate} onChange={(e) => set('endDate', e.target.value)} />
        </label>
      </div>
      <label>Icon</label>
      <div className="chips">
        {EMOJIS.concat(t.countryCodes.map(flag)).map((e) => (
          <button key={e} type="button" className={`chip ${t.coverEmoji === e ? 'on' : ''}`} onClick={() => set('coverEmoji', e)}>
            {e}
          </button>
        ))}
      </div>
      <label>Countries</label>
      <CountryPicker value={t.countryCodes} onChange={(v) => set('countryCodes', v)} />
      <label>
        Places / cities (comma separated, in order)
        <CitiesInput value={t.cities} onChange={(v) => set('cities', v)} />
      </label>
      <StartEndFields value={t} onChange={(v) => onChange({ ...t, ...v })} />
      <label>Travellers</label>
      <TravellersEditor value={t.travellers} onChange={(v) => set('travellers', v)} />
      <label>Pace</label>
      <ChoiceGrid options={STYLES} value={t.style} onChange={(v) => set('style', v)} />
      <label>Budget level</label>
      <ChoiceGrid options={BUDGET_LEVELS} value={t.budgetLevel} onChange={(v) => set('budgetLevel', v)} />
      <label>Interests</label>
      <ChipToggle options={INTERESTS} value={t.interests} onChange={(v) => set('interests', v)} />
      <label>
        Notes & wishes
        <textarea value={t.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
      </label>
    </div>
  )
}
