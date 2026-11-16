import { useState } from 'react'
import { country, countryName, flag, needsAdapter, travelAdvice } from '../lib/countries'
import { t } from '../i18n'
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
        <Empty emoji="🧭" title={t('No country set for this trip')}>
          {t("Add the countries you're visiting in “Trip details” to see emergency numbers, plugs, currency and tipping here.")}
        </Empty>
      </div>
    )
  }
  return (
    <div className="stack-lg" style={{ maxWidth: 820 }}>
      {codes.map((c) => (
        <CountryCard key={c} code={c} home={settings.homeCurrency} nationality={settings.nationality} />
      ))}
      <p className="tiny muted">{t('Built-in facts, available offline. Always confirm entry rules on official government sites.')}</p>
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
        {flag(code)} {countryName(code)}
      </h2>
      <div className="info-grid">
        <div className="info-tile">
          <div className="k">{t('Emergency')}</div>
          <div className="v">
            <a href={`tel:${c.emergency.match(/\d+/)?.[0]}`}>{t(c.emergency)}</a>
          </div>
        </div>
        <div className="info-tile">
          <div className="k">{t('Plugs')}</div>
          <div className="v">
            {t('Type {plugs} · {voltage} V', { plugs: c.plugs.join('/'), voltage: c.voltage })}
          </div>
          {adapter && (
            <div className="tiny muted">
              {adapter.needed ? t('Adapter needed') : t('Your plugs fit')}
              {adapter.voltageDiffers && ` · ${t('different voltage')}`}
            </div>
          )}
        </div>
        <div className="info-tile">
          <div className="k">{t('Driving')}</div>
          <div className="v">{c.drive === 'left' ? t('On the left') : t('On the right')}</div>
        </div>
        <div className="info-tile">
          <div className="k">{t('Capital')}</div>
          <div className="v">{c.capital.name}</div>
        </div>
      </div>

      <div>
        <b className="small">{t('💁 Tipping')}</b>
        <p className="small">{t(c.tipping)}</p>
      </div>
      {c.entryNote && (
        <div>
          <b className="small">{t('🛂 Entry')}</b>
          <p className="small">{t(c.entryNote)}</p>
        </div>
      )}

      {c.currency !== home && <Converter currency={c.currency} home={home} />}

      <div className="row wrap">
        <a className="btn btn-sm" href={`https://en.wikivoyage.org/wiki/${encodeURIComponent(c.name.replace(/ /g, '_'))}`} target="_blank" rel="noreferrer">
          {t('📖 {country} travel guide', { country: countryName(code) })}
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
      <b className="small">{t('💱 Currency')}</b>
      {rate ? (
        <>
          <div className="row">
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ maxWidth: 140 }} aria-label={t('Amount in {currency}', { currency: from })} />
            <button className="btn-sm" onClick={() => setFromLocal((f) => !f)} title={t('Swap')}>
              {from} ⇄
            </button>
            <b className="grow">= {money(fromLocal ? value * rate : value / rate, to, 2)}</b>
          </div>
          <span className="tiny muted">
            {t('1 {currency} = {rate} · saved for offline use · rates from the ECB or', { currency, rate: money(rate, home, 4) })}{' '}
            <a href="https://www.exchangerate-api.com" target="_blank" rel="noreferrer">
              Rates By Exchange Rate API
            </a>
          </span>
        </>
      ) : (
        <span className="small muted">
          {t("{currency} — no exchange rate yet. Open this page once while online and it's saved for offline use.", { currency })}
        </span>
      )}
    </div>
  )
}
