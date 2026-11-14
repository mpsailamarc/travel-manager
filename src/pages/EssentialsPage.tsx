import { useState } from 'react'
import { country, flag, needsAdapter, travelAdvice } from '../lib/countries'
import { fxRate } from '../lib/apis'
import { money } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { Empty } from '../components/ui'
import { useTripCtx } from './TripLayout'

/** Country facts for the trip in one place, instead of on every day: emergency numbers, plugs, money, driving, entry. */
export default function EssentialsPage() {
  const { trip, settings } = useTripCtx()
  const codes = trip.countryCodes.filter((c) => country(c))
  if (!codes.length) {
    return (
      <div className="card">
        <Empty emoji="🧭" title="No country set for this trip">
          Add the countries you're visiting in “Trip details” to see emergency numbers, plugs, currency and tipping here.
        </Empty>
      </div>
    )
  }
  return (
    <div className="stack-lg" style={{ maxWidth: 820 }}>
      {codes.map((c) => (
        <CountryCard key={c} code={c} home={settings.homeCurrency} nationality={settings.nationality} />
      ))}
      <p className="tiny muted">Built-in facts, available offline. Always confirm entry rules on official government sites.</p>
    </div>
  )
}

function CountryCard({ code, home, nationality }: { code: string; home: string; nationality: string }) {
  const c = country(code)!
  const adapter = nationality ? needsAdapter(nationality, code) : undefined
  const advice = nationality ? travelAdvice(nationality) : undefined
  return (
    <div className="card stack">
      <h2>
        {flag(code)} {c.name}
      </h2>
      <div className="info-grid">
        <div className="info-tile">
          <div className="k">Emergency</div>
          <div className="v">
            <a href={`tel:${c.emergency.match(/\d+/)?.[0]}`}>{c.emergency}</a>
          </div>
        </div>
        <div className="info-tile">
          <div className="k">Plugs</div>
          <div className="v">
            Type {c.plugs.join('/')} · {c.voltage} V
          </div>
          {adapter && (
            <div className="tiny muted">
              {adapter.needed ? 'Adapter needed' : 'Your plugs fit'}
              {adapter.voltageDiffers && ' · different voltage'}
            </div>
          )}
        </div>
        <div className="info-tile">
          <div className="k">Driving</div>
          <div className="v">On the {c.drive}</div>
        </div>
        <div className="info-tile">
          <div className="k">Capital</div>
          <div className="v">{c.capital.name}</div>
        </div>
      </div>

      <div>
        <b className="small">💁 Tipping</b>
        <p className="small">{c.tipping}</p>
      </div>
      {c.entryNote && (
        <div>
          <b className="small">🛂 Entry</b>
          <p className="small">{c.entryNote}</p>
        </div>
      )}

      {c.currency !== home && <Converter currency={c.currency} home={home} />}

      <div className="row wrap">
        <a className="btn btn-sm" href={`https://en.wikivoyage.org/wiki/${encodeURIComponent(c.name.replace(/ /g, '_'))}`} target="_blank" rel="noreferrer">
          📖 {c.name} travel guide
        </a>
        {advice && (
          <a className="btn btn-sm" href={advice.url} target="_blank" rel="noreferrer">
            🏛️ {advice.label}
          </a>
        )}
      </div>
    </div>
  )
}

function Converter({ currency, home }: { currency: string; home: string }) {
  const { data: rate } = useAsync(() => fxRate(currency, home), [currency, home])
  const [amount, setAmount] = useState('100')
  const [fromLocal, setFromLocal] = useState(true)
  const value = Number(amount.replace(',', '.')) || 0
  const from = fromLocal ? currency : home
  const to = fromLocal ? home : currency
  return (
    <div className="stack" style={{ gap: 6 }}>
      <b className="small">💱 Currency</b>
      {rate ? (
        <>
          <div className="row">
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ maxWidth: 140 }} aria-label={`Amount in ${from}`} />
            <button className="btn-sm" onClick={() => setFromLocal((f) => !f)} title="Swap">
              {from} ⇄
            </button>
            <b className="grow">= {money(fromLocal ? value * rate : value / rate, to, 2)}</b>
          </div>
          <span className="tiny muted">
            1 {currency} = {money(rate, home, 4)} · saved for offline use · rates from the ECB or{' '}
            <a href="https://www.exchangerate-api.com" target="_blank" rel="noreferrer">
              Rates By Exchange Rate API
            </a>
          </span>
        </>
      ) : (
        <span className="small muted">
          {currency} — no exchange rate yet. Open this page once while online and it's saved for offline use.
        </span>
      )}
    </div>
  )
}
