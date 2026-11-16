import { useEffect, useRef, useState } from 'react'
import type { BudgetLevel, InnerFlights, Traveller, Trip, TripFocus, TripStyle } from '../types'
import { COUNTRIES, countryLabel, countryName, flag } from '../lib/countries'
import { searchPlaces } from '../lib/apis'
import { uid } from '../lib/ids'
import { PlaceSearch } from '../components/PlaceSearch'

export const INTERESTS = [
  'history', 'museums', 'architecture', 'food', 'markets', 'nature', 'hiking', 'beaches', 'wildlife', 'art',
  'viewpoints', 'local culture', 'nightlife', 'shopping', 'theme parks', 'aquariums', 'photography', 'wellness', 'wine', 'road trip',
]

export const STYLES: Record<TripStyle, { label: string; desc: string }> = {
  relaxed: { label: '🐢 Relaxed', desc: '1–2 things a day, lots of downtime' },
  balanced: { label: '🚶 Balanced', desc: 'A plan each day with breaks' },
  packed: { label: '🏃 Packed', desc: 'See as much as possible: about 90% of the day, 9:00–21:00' },
  intense: { label: '⚡ All out', desc: 'Up at dawn, out until late, long walks, meals on the go: 7:00 to midnight' },
}

export const BUDGET_LEVELS: Record<BudgetLevel, { label: string; desc: string }> = {
  shoestring: { label: '🎒 Shoestring', desc: 'Hostels, street food, public transport' },
  mid: { label: '🏨 Mid-range', desc: '3★ hotels, nice restaurants sometimes' },
  comfort: { label: '🛎️ Comfort', desc: '4★ hotels, taxis when useful' },
  luxury: { label: '💎 Luxury', desc: 'The best of everything' },
}

export const FOCUS: Record<TripFocus, { label: string; desc: string }> = {
  cities: { label: '🏛️ Cities', desc: 'Sights, museums and food; nature as day trips' },
  mix: { label: '⚖️ A mix', desc: 'Cities, countryside and some walks' },
  outdoors: { label: '🥾 Road trip & hikes', desc: 'Scenic drives, small towns, trails; short city stops' },
}

export const INNER_FLIGHTS: Record<InnerFlights, { label: string; desc: string }> = {
  auto: { label: '🤔 You decide', desc: 'With 2 or more people, lean towards driving or trains' },
  fly: { label: '✈️ Fly when faster', desc: 'Time matters more than cost' },
  few: { label: '🛬 Only long hops', desc: 'One or two flights at most' },
  none: { label: '🚗 No flights', desc: 'Road, train or ferry between places' },
}

/** Why the planner leans away from flights for a group, in a line (nothing for one person or when you chose). */
export function groupTravelHint(t: Trip) {
  const n = t.travellers.length
  return n >= 2 && (t.innerFlights ?? 'auto') === 'auto'
    ? `With ${n} travellers every flight is paid ${n} times, while a rental car costs the same for everyone, so the plan will drive or take the train when that's reasonable.`
    : undefined
}

/** Cities or the outdoors, and flights between places: the two questions that shape the route. */
export function RouteFields({ value: t, onChange }: { value: Trip; onChange: (v: Partial<Pick<Trip, 'focus' | 'innerFlights'>>) => void }) {
  const hint = groupTravelHint(t)
  return (
    <>
      <label>Cities or the outdoors?</label>
      <ChoiceGrid options={FOCUS} value={t.focus ?? 'mix'} onChange={(v) => onChange({ focus: v })} />
      <label>Flights between places</label>
      <ChoiceGrid options={INNER_FLIGHTS} value={t.innerFlights ?? 'auto'} onChange={(v) => onChange({ innerFlights: v })} />
      {hint && <p className="tiny muted" style={{ margin: 0 }}>👥 {hint}</p>}
    </>
  )
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

// Countries people type by a short name.
const COUNTRY_ALIASES: Record<string, string> = { uk: 'GB', 'united kingdom': 'GB', england: 'GB', scotland: 'GB', wales: 'GB', britain: 'GB', 'great britain': 'GB', usa: 'US', us: 'US', america: 'US', 'united states': 'US', holland: 'NL', uae: 'AE' }
const countryOf = (text: string) => {
  const t = text.trim().toLowerCase()
  return COUNTRY_ALIASES[t] ?? COUNTRIES.find((c) => c.name.toLowerCase() === t)?.code
}

/**
 * Where to, in one box: cities, regions or whole countries, in the order you'll visit them. Each place's country is looked
 * up (OpenStreetMap, once, cached) and the trip's countries follow by themselves; a country typed on its own stays too.
 */
export function DestinationInput({ cities, countryCodes, onChange }: { cities: string[]; countryCodes: string[]; onChange: (v: { cities: string[]; countryCodes: string[] }) => void }) {
  const [text, setText] = useState('')
  const [places, setPlaces] = useState(cities)
  const [whole, setWhole] = useState(countryCodes) // countries chosen as such ("Italy")
  const [found, setFound] = useState<Record<string, string | null>>({}) // place (lower case) → its country, null when unknown
  const looking = useRef(new Set<string>())
  const report = useRef(onChange)
  report.current = onChange

  // Each new place gets its country looked up once.
  useEffect(() => {
    for (const p of places) {
      const k = p.toLowerCase()
      if (k in found || looking.current.has(k)) continue
      looking.current.add(k)
      searchPlaces(p)
        .then((r) => setFound((f) => ({ ...f, [k]: r[0]?.countryCode ?? null })))
        .catch(() => setFound((f) => ({ ...f, [k]: null })))
    }
  }, [places, found])

  // The trip's countries: the places' countries in order, then any country chosen on its own.
  const countries = [...new Set([...places.map((p) => found[p.toLowerCase()]).filter((c): c is string => !!c), ...whole])]
  useEffect(() => {
    report.current({ cities: places, countryCodes: countries })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places.join('|'), countries.join('|')])

  function add(raw: string) {
    const parts = raw.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean)
    let ps = places
    let ws = whole
    for (const part of parts) {
      const code = countryOf(part)
      if (code) ws = ws.includes(code) ? ws : [...ws, code]
      else if (!ps.some((p) => p.toLowerCase() === part.toLowerCase())) ps = [...ps, part]
    }
    setPlaces(ps)
    setWhole(ws)
    setText('')
  }

  const q = text.trim().toLowerCase()
  const countryHits = q.length >= 2 ? COUNTRIES.filter((c) => c.name.toLowerCase().startsWith(q) && !whole.includes(c.code)).slice(0, 5) : []
  return (
    <div className="stack" style={{ gap: 8 }}>
      {(places.length > 0 || whole.length > 0) && (
        <div className="chips">
          {places.map((p) => {
            const c = found[p.toLowerCase()]
            return (
              <button key={p} type="button" className="chip on" title="Remove" onClick={() => setPlaces(places.filter((x) => x !== p))}>
                {c ? flag(c) : c === null ? '📍' : '…'} {p} ✕
              </button>
            )
          })}
          {whole.map((c) => (
            <button key={c} type="button" className="chip on" title="Remove" onClick={() => setWhole(whole.filter((x) => x !== c))}>
              {countryLabel(c)} (anywhere) ✕
            </button>
          ))}
        </div>
      )}
      <div className="row">
        <input
          className="grow"
          value={text}
          placeholder={places.length || whole.length ? 'Add another place…' : 'e.g. Rome, Florence, Amalfi Coast — or a country'}
          onChange={(e) => (e.target.value.includes(',') ? add(e.target.value) : setText(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (text.trim()) add(text)
            }
          }}
          onBlur={() => text.trim() && add(text)}
        />
        <button type="button" className="btn-sm" disabled={!text.trim()} onClick={() => add(text)}>
          ＋ Add
        </button>
      </div>
      {countryHits.length > 0 && (
        <div className="chips">
          {countryHits.map((c) => (
            <button key={c.code} type="button" className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => add(c.name)}>
              {flag(c.code)} {c.name} (the whole country)
            </button>
          ))}
        </div>
      )}
      <p className="tiny muted" style={{ margin: 0 }}>
        {countries.length
          ? `Countries: ${countries.map(countryName).join(', ')} — filled in from your places.`
          : 'Type cities or regions in the order you’d visit them, or just a country. Their countries are filled in for you.'}
        {places.some((p) => found[p.toLowerCase()] === null) && ' 📍 = country not found (offline, or an unusual name): add the country too.'}
      </p>
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
export function StartEndFields({ value, onChange, hint }: { value: Pick<Trip, 'startPlace' | 'endPlace'>; onChange: (v: Pick<Trip, 'startPlace' | 'endPlace'>) => void; hint?: string }) {
  const sameEnd = !value.endPlace
  return (
    <div className="stack" style={{ gap: 8 }}>
      <PlaceSearch label="Starting from" value={value.startPlace} onChange={(p) => onChange({ ...value, startPlace: p })} placeholder="e.g. San Francisco" />
      {hint && <p className="tiny muted" style={{ margin: 0 }}>{hint}</p>}
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

/** "2 adults + 1 child (8)" */
export function travellersText(ts: Traveller[]) {
  const adults = ts.filter((x) => x.type === 'adult').length
  const kids = ts.filter((x) => x.type === 'child')
  return `${adults} adult${adults === 1 ? '' : 's'}${kids.length ? ` + ${kids.length} ${kids.length === 1 ? 'child' : 'children'}${kids.some((k) => k.age != null) ? ` (${kids.map((k) => k.age ?? '?').join(', ')})` : ''}` : ''}`
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
      <p className="small" style={{ margin: 0 }}>
        👥 {travellersText(t.travellers)} · <span className="muted">change who is travelling in the Budget tab, where the costs follow.</span>
      </p>
      <label>Pace</label>
      <ChoiceGrid options={STYLES} value={t.style} onChange={(v) => set('style', v)} />
      <label>Budget level</label>
      <ChoiceGrid options={BUDGET_LEVELS} value={t.budgetLevel} onChange={(v) => set('budgetLevel', v)} />
      <RouteFields value={t} onChange={(v) => onChange({ ...t, ...v })} />
      <label>Interests</label>
      <ChipToggle options={INTERESTS} value={t.interests} onChange={(v) => set('interests', v)} />
      <label>
        Notes & wishes
        <textarea value={t.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
      </label>
    </div>
  )
}
