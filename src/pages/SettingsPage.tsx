import { useRef } from 'react'
import { db, requestPersistentStorage } from '../db'
import type { GetAround, Settings } from '../types'
import { DEFAULT_WALK_MAX_MIN, GET_AROUND_LABEL } from '../lib/legs'
import { COUNTRIES, CURRENCIES, flag } from '../lib/countries'
import { download, exportEverything, importAny } from '../lib/share'
import { useAsync, useSettings } from '../lib/hooks'
import { bytes } from '../lib/format'
import { toast } from '../components/ui'
import { SyncCard } from '../components/SyncCard'
import { AiCard } from '../components/AiCard'
import { getConfig } from '../lib/sync'
import { lang, LANGS, setLang, t, tn } from '../i18n'

/** Drops the saved copy of the app (not your data) and reloads, so the newest version is fetched. */
async function forceUpdate() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations()) ?? []
    await Promise.all(regs.map((r) => r.unregister()))
    for (const k of await caches.keys()) if (!k.startsWith('map-tiles') && k !== 'wiki') await caches.delete(k)
  } catch {
    /* reload anyway */
  }
  toast(t('Updating…'))
  setTimeout(() => location.reload(), 400)
}

export default function SettingsPage() {
  const s = useSettings()
  const fileRef = useRef<HTMLInputElement>(null)
  const { data: usage } = useAsync(async () => (navigator.storage?.estimate ? navigator.storage.estimate() : undefined), [])
  const { data: persisted } = useAsync(async () => (navigator.storage?.persisted ? navigator.storage.persisted() : false), [])

  const set = async (patch: Partial<Settings>) => {
    await db.settings.put({ ...s, ...patch })
  }

  return (
    <div className="page stack-lg" style={{ maxWidth: 720 }}>
      <h1>{t('Settings')}</h1>
      <div className="card stack">
        <h3>{t('Language')}</h3>
        <div className="chips">
          {LANGS.map((l) => (
            <button key={l.code} className={`chip ${lang() === l.code ? 'on' : ''}`} onClick={() => lang() !== l.code && setLang(l.code)}>
              {l.label}
            </button>
          ))}
        </div>
        <p className="small muted">
          {t('The app, and what ChatGPT writes for you, in this language. To open the app in a language from a link, add ?lang=fr (or ?lang=en) to its address; it is remembered on that device.')}
        </p>
        <p className="tiny muted" style={{ margin: 0, wordBreak: 'break-all' }}>
          {location.origin}
          {location.pathname}?lang=fr
        </p>
      </div>
      <div className="card stack">
        <h3>{t('About you')}</h3>
        <div className="form-grid">
          <label>
            {t('Your name')}
            <input defaultValue={s.name} key={s.name} onBlur={(e) => set({ name: e.target.value })} />
          </label>
          <label>
            {t('Nationality (passport)')}
            <select value={s.nationality} onChange={(e) => set({ nationality: e.target.value })}>
              <option value="">{t('Choose…')}</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {flag(c.code)} {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('Home currency')}
            <select value={s.homeCurrency} onChange={(e) => set({ homeCurrency: e.target.value })}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            {t('Home city or usual airport')}
            <input defaultValue={s.homeAirport ?? ''} key={s.homeAirport} placeholder={t('e.g. Paris, or Paris CDG')} onBlur={(e) => set({ homeAirport: e.target.value || undefined })} />
            <span className="tiny muted">{t('New trips (and trips with no start set) start and end here.')}</span>
          </label>
          <label>
            {t('Walking speed')}
            <select value={s.walkSpeedKmh} onChange={(e) => set({ walkSpeedKmh: Number(e.target.value) })}>
              <option value={3}>{t('Slow — small kids (3 km/h)')}</option>
              <option value={4}>{t('Relaxed (4 km/h)')}</option>
              <option value={4.5}>{t('Normal (4.5 km/h)')}</option>
              <option value={5.5}>{t('Brisk (5.5 km/h)')}</option>
            </select>
          </label>
          <label>
            {t('Short hop = walk up to')}
            <select value={s.walkMaxMin ?? DEFAULT_WALK_MAX_MIN} onChange={(e) => set({ walkMaxMin: Number(e.target.value) })}>
              {[5, 10, 15, 20, 30].map((m) => (
                <option key={m} value={m}>
                  {t('{n} min', { n: m })}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('Maps (Plan, Day by day, City planner)')}
            <select value={s.mapSize ?? 'small'} onChange={(e) => set({ mapSize: e.target.value as 'small' | 'large' | 'hidden' })}>
              <option value="small">{t('Small')}</option>
              <option value="large">{t('Large')}</option>
              <option value="hidden">{t('Hidden (tap to show)')}</option>
            </select>
          </label>
          <label className="full">
            {t('Between places in the City planner')}
            <select value={s.getAround ?? 'transit'} onChange={(e) => set({ getAround: e.target.value as GetAround })}>
              {(Object.keys(GET_AROUND_LABEL) as GetAround[]).map((k) => (
                <option key={k} value={k}>
                  {GET_AROUND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="tiny muted">{t('Used for visa links, plug adapters, roaming advice, budget estimates and walking times. Synced between your devices if sync is on.')}</p>
      </div>

      <SyncCard />

      <AiCard />

      <div className="card stack">
        <h3>{t('Your data')}</h3>
        <p className="small">
          {t('Everything is stored in this browser on this device')}
          {usage?.usage != null && ` ${t('({size} used)', { size: bytes(usage.usage) })}`}.{' '}
          {getConfig() ? t('With sync on, a copy is also kept on your sync server, encrypted with your code.') : t('Nothing is sent to a server.')} {t('Storage is')}{' '}
          <b>{persisted ? t('persistent') : t('not yet persistent')}</b>.
        </p>
        <div className="row wrap">
          {!persisted && (
            <button onClick={async () => toast((await requestPersistentStorage()) ? t('Storage is now persistent') : t('Declined — try installing the app first'))}>
              {t('🔒 Keep my data')}
            </button>
          )}
          <button onClick={async () => download(await exportEverything())}>{t('💾 Back up all trips')}</button>
          <button onClick={() => fileRef.current?.click()}>{t('📥 Restore / import')}</button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              try {
                const ids = await importAny(await f.text())
                toast(tn(ids.length, 'Imported {n} trip', 'Imported {n} trips'))
              } catch (err) {
                toast((err as Error).message)
              }
            }}
          />
        </div>
      </div>

      <div className="card stack">
        <h3>{t('App version')}</h3>
        <p className="small">
          <b>{__APP_VERSION__}</b>
        </p>
        <p className="small muted">
          {t('Installed apps keep a saved copy and can take a couple of opens to update. If this device behaves differently from another one, compare the version numbers — and tap below to load the latest copy. Your trips and settings are not affected.')}
        </p>
        <div>
          <button onClick={forceUpdate}>{t('🔄 Force update')}</button>
        </div>
      </div>

      <div className="card stack">
        <h3>{t('Install on your phone')}</h3>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>
            <b>{t('Android (Chrome):')}</b> {t('menu ⋮ →')} <i>{t('Install app')}</i> ({t('or')} <i>{t('Add to Home screen')}</i>).
          </li>
          <li>
            <b>{t('iPhone (Safari):')}</b> {t('Share button →')} <i>{t('Add to Home Screen')}</i>.
          </li>
          <li>{t('Once installed, open each day once while online so maps and weather are cached for offline use.')}</li>
        </ul>
      </div>

      <div className="card stack">
        <h3>{t('Free services used')}</h3>
        <p className="small muted">
          {t('Maps ©')} <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>, {t('tiles by')} <a href="https://openfreemap.org">OpenFreeMap</a> · {t('Sights via the Overpass API')} ·{' '}
          {t('Walking routes by')} <a href="https://routing.openstreetmap.de">FOSSGIS OSRM</a> · {t('Place search by Nominatim')} · {t('Descriptions & photos from Wikipedia/Wikidata (CC BY-SA)')} ·{' '}
          {t('Weather by')} <a href="https://open-meteo.com">Open-Meteo</a> · {t('Exchange rates by')} <a href="https://frankfurter.dev">Frankfurter</a>{' '}
          (ECB) {t('and')} <a href="https://www.exchangerate-api.com">Rates By Exchange Rate API</a>. {t('All free for personal use, no accounts or keys.')}
        </p>
      </div>
    </div>
  )
}
