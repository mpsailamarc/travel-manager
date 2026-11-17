import { useEffect, useRef, useState } from 'react'
import type { BudgetLevel, GetThere, InnerFlights, Traveller, Trip, TripFocus, TripStyle } from '../types'
import { COUNTRIES, countryLabel, countryName, flag } from '../lib/countries'
import { searchPlaces } from '../lib/apis'
import { uid } from '../lib/ids'
import { PlaceSearch } from '../components/PlaceSearch'
import { t as tr, tn } from '../i18n'

export const INTERESTS = [
  'history', 'museums', 'architecture', 'food', 'markets', 'nature', 'hiking', 'beaches', 'wildlife', 'art',
  'viewpoints', 'local culture', 'nightlife', 'shopping', 'theme parks', 'aquariums', 'photography', 'wellness', 'wine', 'road trip',
]

export const STYLES: Record<TripStyle, { label: string; desc: string }> = {
  relaxed: { label: tr('🐢 Relaxed'), desc: tr('1–2 things a day, lots of downtime') },
  balanced: { label: tr('🚶 Balanced'), desc: tr('A plan each day with breaks') },
  packed: { label: tr('🏃 Packed'), desc: tr('See as much as possible: about 90% of the day, 9:00–21:00') },
  intense: { label: tr('⚡ All out'), desc: tr('Up at dawn, out until late, long walks, meals on the go: 7:00 to midnight') },
}

export const BUDGET_LEVELS: Record<BudgetLevel, { label: string; desc: string }> = {
  shoestring: { label: tr('🎒 Shoestring'), desc: tr('Hostels, street food, public transport') },
  mid: { label: tr('🏨 Mid-range'), desc: tr('3★ hotels, nice restaurants sometimes') },
  comfort: { label: tr('🛎️ Comfort'), desc: tr('4★ hotels, taxis when useful') },
  luxury: { label: tr('💎 Luxury'), desc: tr('The best of everything') },
}

export const FOCUS: Record<TripFocus, { label: string; desc: string }> = {
  cities: { label: tr('🏛️ Cities'), desc: tr('Sights, museums and food; nature as day trips') },
  mix: { label: tr('⚖️ A mix'), desc: tr('Cities, countryside and some walks') },
  outdoors: { label: tr('🥾 Road trip & hikes'), desc: tr('Scenic drives, small towns, trails; short city stops') },
}

export const INNER_FLIGHTS: Record<InnerFlights, { label: string; desc: string }> = {
  auto: { label: tr('🤔 You decide'), desc: tr('With 2 or more people, lean towards driving or trains') },
  fly: { label: tr('✈️ Fly when faster'), desc: tr('Time matters more than cost') },
  few: { label: tr('🛬 Only long hops'), desc: tr('One or two flights at most') },
  none: { label: tr('🚗 No flights'), desc: tr('Road, train or ferry between places') },
}

/** Why the planner leans away from flights for a group, in a line (nothing for one person or when you chose). */
export function groupTravelHint(t: Trip) {
  const n = t.travellers.length
  return n >= 2 && (t.innerFlights ?? 'auto') === 'auto' && t.willDrive !== false
    ? tr("With {n} travellers every flight is paid {n} times, while a rental car costs the same for everyone, so the plan will drive or take the train when that's reasonable.", { n })
    : undefined
}

export const GET_THERE: Record<GetThere, { label: string; desc: string }> = {
  plane: { label: tr('✈️ Plane'), desc: tr('Fly there and back') },
  rental: { label: tr('🚙 Rental car'), desc: tr('Drive there in a rental car: no flights') },
  own: { label: tr('🚗 My own car'), desc: tr('Drive there in your own car: no flights, no rental') },
  other: { label: tr('🚆 Train, bus or ferry'), desc: tr('No flights, no car needed to get there') },
}

/** How you get to the destination: it decides whether the plan has flights, a rental car or a long drive. */
export function GetThereFields({ value: t, onChange }: { value: Trip; onChange: (v: Pick<Trip, 'getThere'>) => void }) {
  return (
    <>
      <label>{tr('How do you get there?')}</label>
      <ChoiceGrid options={GET_THERE} value={t.getThere ?? 'plane'} onChange={(v) => onChange({ getThere: v === 'plane' ? undefined : v })} />
      {(t.getThere ?? 'plane') !== 'plane' && <p className="tiny muted" style={{ margin: 0 }}>{tr('The plan and the budget then have no flights from and to home: the journey there is by the way you chose.')}</p>}
    </>
  )
}

/** Where you sleep. One single place for the whole trip only makes sense when the destination is one place (one city or area typed). */
export const SLEEP: Record<'hotels' | 'camper' | 'friends' | 'single', { label: string; desc: string }> = {
  hotels: { label: tr('🏨 Hotels'), desc: tr('Hotels, B&Bs or apartments') },
  camper: { label: tr('🚐 Camper van'), desc: tr('Sleep in the van, at campsites') },
  friends: { label: tr('🏡 With friends or family'), desc: tr('Staying with people you know: nothing to book or pay') },
  single: { label: tr('📍 One single place'), desc: tr('The same bed every night, day trips from it') },
}
export const couldBeOnePlace = (t: Pick<Trip, 'cities'>) => t.cities.length === 1

const DRIVE: Record<'yes' | 'no', { label: string; desc: string }> = {
  yes: { label: tr('🚗 Happy to drive'), desc: tr('A rental car is fine where it helps') },
  no: { label: tr('🚫 I would rather not drive'), desc: tr('Trains, buses, taxis and tours instead') },
}

/** Cities or the outdoors, flights between places, driving yourself and where you sleep: the questions that shape the route. */
export function RouteFields({ value: t, onChange }: { value: Trip; onChange: (v: Partial<Pick<Trip, 'focus' | 'innerFlights' | 'sleep' | 'willDrive'>>) => void }) {
  const hint = groupTravelHint(t)
  const one = couldBeOnePlace(t)
  const sleepOptions = Object.fromEntries(Object.entries(SLEEP).filter(([k]) => k !== 'single' || one)) as Partial<typeof SLEEP> as typeof SLEEP
  const sleep = t.sleep === 'single' && !one ? 'hotels' : (t.sleep ?? 'hotels')
  return (
    <>
      <label>{tr('Cities or the outdoors?')}</label>
      <ChoiceGrid options={FOCUS} value={t.focus ?? 'mix'} onChange={(v) => onChange({ focus: v })} />
      <label>{tr('Flights between places')}</label>
      <ChoiceGrid options={INNER_FLIGHTS} value={t.innerFlights ?? 'auto'} onChange={(v) => onChange({ innerFlights: v })} />
      {hint && <p className="tiny muted" style={{ margin: 0 }}>👥 {hint}</p>}
      <label>{tr('Driving yourself')}</label>
      <ChoiceGrid options={DRIVE} value={t.willDrive === false ? 'no' : 'yes'} onChange={(v) => onChange({ willDrive: v === 'no' ? false : undefined })} />
      <label>{tr('Where you sleep')}</label>
      <ChoiceGrid options={sleepOptions} value={sleep} onChange={(v) => onChange({ sleep: v })} />
    </>
  )
}

export const EMOJIS = ['🧳', '🏖️', '🏔️', '🏙️', '🏛️', '🌴', '🗺️', '🚂', '⛩️', '🏝️', '🎒', '🐘', '❄️', '🍝', '🍣', '🌋']

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
  // A trip's places can list a city once per day ("Gothenburg, Gothenburg, …"): each shows once, in order.
  const [places, setPlaces] = useState(() => cities.filter((c, i) => cities.findIndex((x) => x.toLowerCase() === c.toLowerCase()) === i))
  const [whole, setWhole] = useState(countryCodes) // countries chosen as such ("Italy")
  const [found, setFound] = useState<Record<string, string | null>>({}) // place (lower case) → its country, null when unknown
  const looking = useRef(false)
  const report = useRef(onChange)
  report.current = onChange
  // A trip saved before this box kept its countries apart from its places: once a place's country is known, that country
  // follows the place (remove the place and it goes), as it does for places added here.
  const saved = useRef(new Set(countryCodes))

  // Each place gets its country looked up once, one at a time (the free service asks for no more than one request a second).
  useEffect(() => {
    if (looking.current) return
    const next = places.find((p) => !(p.toLowerCase() in found))
    if (!next) return
    looking.current = true
    const k = next.toLowerCase()
    searchPlaces(next)
      .then((r) => r[0]?.countryCode ?? null)
      .catch(() => null)
      .then((code) => {
        looking.current = false
        if (code && saved.current.has(code)) {
          saved.current.delete(code)
          setWhole((w) => w.filter((c) => c !== code))
        }
        setFound((f) => ({ ...f, [k]: code }))
      })
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
              <button key={p} type="button" className="chip on" title={tr('Remove')} onClick={() => setPlaces(places.filter((x) => x !== p))}>
                {c ? flag(c) : c === null ? '📍' : '…'} {p} ✕
              </button>
            )
          })}
          {whole.map((c) => (
            <button key={c} type="button" className="chip on" title={tr('Remove')} onClick={() => setWhole(whole.filter((x) => x !== c))}>
              {tr('{country} (anywhere) ✕', { country: countryLabel(c) })}
            </button>
          ))}
        </div>
      )}
      <div className="row">
        <input
          className="grow"
          value={text}
          placeholder={places.length || whole.length ? tr('Add another place…') : tr('e.g. Rome, Florence, Amalfi Coast — or a country')}
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
          {tr('＋ Add')}
        </button>
      </div>
      {countryHits.length > 0 && (
        <div className="chips">
          {countryHits.map((c) => (
            <button key={c.code} type="button" className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => add(c.name)}>
              {flag(c.code)} {tr('{country} (the whole country)', { country: c.name })}
            </button>
          ))}
        </div>
      )}
      <p className="tiny muted" style={{ margin: 0 }}>
        {countries.length
          ? tr('Countries: {list} — filled in from your places.', { list: countries.map(countryName).join(', ') })
          : tr('Type cities or regions in the order you’d visit them, or just a country. Their countries are filled in for you.')}
        {places.some((p) => found[p.toLowerCase()] === null) && ' ' + tr('📍 = country not found (offline, or an unusual name): add the country too.')}
      </p>
    </div>
  )
}

/** Where the trip starts and ends (often the same place): drawn on the map and told to the AI. */
export function StartEndFields({ value, onChange, hint }: { value: Pick<Trip, 'startPlace' | 'endPlace'>; onChange: (v: Pick<Trip, 'startPlace' | 'endPlace'>) => void; hint?: string }) {
  const sameEnd = !value.endPlace
  return (
    <div className="stack" style={{ gap: 8 }}>
      <PlaceSearch label={tr('Starting from')} value={value.startPlace} onChange={(p) => onChange({ ...value, startPlace: p })} placeholder={tr('e.g. San Francisco')} />
      {hint && <p className="tiny muted" style={{ margin: 0 }}>{hint}</p>}
      {value.startPlace && (
        <>
          <label className="inline small">
            <input
              type="checkbox"
              checked={sameEnd}
              onChange={(e) => onChange({ ...value, endPlace: e.target.checked ? undefined : { name: value.startPlace?.name ?? '' } })}
            />{' '}
            {tr('Return to the same place')}
          </label>
          {!sameEnd && <PlaceSearch label={tr('Returning to')} value={value.endPlace} onChange={(p) => onChange({ ...value, endPlace: p ?? { name: '' } })} placeholder={tr('e.g. Los Angeles')} />}
          <p className="tiny muted">{tr('Tap “Find” so it appears on the map. Starting in the same country as your destination also means no flights in the budget estimate.')}</p>
        </>
      )}
    </div>
  )
}

/** "2 adults + 1 child (8)" */
export function travellersText(ts: Traveller[]) {
  const adults = ts.filter((x) => x.type === 'adult').length
  const kids = ts.filter((x) => x.type === 'child')
  return `${tn(adults, '{n} adult', '{n} adults')}${kids.length ? ` + ${tn(kids.length, '{n} child', '{n} children')}${kids.some((k) => k.age != null) ? ` (${kids.map((k) => k.age ?? '?').join(', ')})` : ''}` : ''}`
}

/** `firstAdult`: what the first adult added is called when the list has no adult yet ("Partner" in Settings, where you aren't in the list). */
export function TravellersEditor({ value, onChange, firstAdult }: { value: Traveller[]; onChange: (v: Traveller[]) => void; firstAdult?: string }) {
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
              placeholder={tr('Age')}
              value={t.age ?? ''}
              onChange={(e) => update(t.id, { age: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
          )}
          <button type="button" className="icon-btn" onClick={() => onChange(value.filter((x) => x.id !== t.id))} aria-label={tr('Remove')}>
            ✕
          </button>
        </div>
      ))}
      <div className="row">
        <button type="button" className="btn-sm" onClick={() => onChange([...value, { id: uid(), type: 'adult', name: firstAdult && !value.some((v) => v.type === 'adult') ? firstAdult : tr('Adult {n}', { n: value.filter((v) => v.type === 'adult').length + 1 + (firstAdult ? 1 : 0) }) }])}>
          {tr('+ Adult')}
        </button>
        <button type="button" className="btn-sm" onClick={() => onChange([...value, { id: uid(), type: 'child', name: tr('Child {n}', { n: value.filter((v) => v.type === 'child').length + 1 }), age: 8 }])}>
          {tr('+ Child')}
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
          {tr(o)}
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
          {tr('Name')}
          <input value={t.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label>
          {tr('First day there (you land)')}
          <input type="date" value={t.startDate} onChange={(e) => set('startDate', e.target.value)} />
        </label>
        <label>
          {tr('Last day there (you fly out)')}
          <input type="date" value={t.endDate} onChange={(e) => set('endDate', e.target.value)} />
        </label>
        <p className="tiny muted full" style={{ margin: 0 }}>
          {tr('The days at the destination, not counting the flights from and to home (the flight out may leave the day before).')}
        </p>
      </div>
      <label>{tr('Icon')}</label>
      <div className="chips">
        {EMOJIS.concat(t.countryCodes.map(flag)).map((e) => (
          <button key={e} type="button" className={`chip ${t.coverEmoji === e ? 'on' : ''}`} onClick={() => set('coverEmoji', e)}>
            {e}
          </button>
        ))}
      </div>
      <label>{tr('Where to')}</label>
      <DestinationInput cities={t.cities} countryCodes={t.countryCodes} onChange={(v) => onChange({ ...t, ...v })} />
      <StartEndFields value={t} onChange={(v) => onChange({ ...t, ...v })} />
      <GetThereFields value={t} onChange={(v) => onChange({ ...t, ...v })} />
      <label>{tr('Travellers')}</label>
      <p className="small" style={{ margin: 0 }}>
        👥 {travellersText(t.travellers)} · <span className="muted">{tr('change who is travelling in the Budget tab, where the costs follow.')}</span>
      </p>
      <label>{tr('Pace')}</label>
      <ChoiceGrid options={STYLES} value={t.style} onChange={(v) => set('style', v)} />
      <label>{tr('Budget level')}</label>
      <ChoiceGrid options={BUDGET_LEVELS} value={t.budgetLevel} onChange={(v) => set('budgetLevel', v)} />
      <RouteFields value={t} onChange={(v) => onChange({ ...t, ...v })} />
      <label>{tr('Interests')}</label>
      <ChipToggle options={INTERESTS} value={t.interests} onChange={(v) => set('interests', v)} />
      <label>
        {tr('Notes & wishes')}
        <textarea value={t.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
      </label>
    </div>
  )
}
