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

/** Drops the saved copy of the app (not your data) and reloads, so the newest version is fetched. */
async function forceUpdate() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations()) ?? []
    await Promise.all(regs.map((r) => r.unregister()))
    for (const k of await caches.keys()) if (!k.startsWith('map-tiles') && k !== 'wiki') await caches.delete(k)
  } catch {
    /* reload anyway */
  }
  toast('Updating…')
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
      <h1>Settings</h1>
      <div className="card stack">
        <h3>About you</h3>
        <div className="form-grid">
          <label>
            Your name
            <input defaultValue={s.name} key={s.name} onBlur={(e) => set({ name: e.target.value })} />
          </label>
          <label>
            Nationality (passport)
            <select value={s.nationality} onChange={(e) => set({ nationality: e.target.value })}>
              <option value="">Choose…</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {flag(c.code)} {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Home currency
            <select value={s.homeCurrency} onChange={(e) => set({ homeCurrency: e.target.value })}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Usual departure airport
            <input defaultValue={s.homeAirport ?? ''} key={s.homeAirport} placeholder="e.g. Paris CDG" onBlur={(e) => set({ homeAirport: e.target.value || undefined })} />
          </label>
          <label>
            Walking speed
            <select value={s.walkSpeedKmh} onChange={(e) => set({ walkSpeedKmh: Number(e.target.value) })}>
              <option value={3}>Slow — small kids (3 km/h)</option>
              <option value={4}>Relaxed (4 km/h)</option>
              <option value={4.5}>Normal (4.5 km/h)</option>
              <option value={5.5}>Brisk (5.5 km/h)</option>
            </select>
          </label>
          <label>
            Short hop = walk up to
            <select value={s.walkMaxMin ?? DEFAULT_WALK_MAX_MIN} onChange={(e) => set({ walkMaxMin: Number(e.target.value) })}>
              {[5, 10, 15, 20, 30].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </label>
          <label className="full">
            Between places in the City planner
            <select value={s.getAround ?? 'transit'} onChange={(e) => set({ getAround: e.target.value as GetAround })}>
              {(Object.keys(GET_AROUND_LABEL) as GetAround[]).map((k) => (
                <option key={k} value={k}>
                  {GET_AROUND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="tiny muted">Used for visa links, plug adapters, roaming advice, budget estimates and walking times. Synced between your devices if sync is on.</p>
      </div>

      <SyncCard />

      <AiCard />

      <div className="card stack">
        <h3>Your data</h3>
        <p className="small">
          Everything is stored in this browser on this device
          {usage?.usage != null && ` (${bytes(usage.usage)} used)`}.{' '}
          {getConfig() ? 'With sync on, a copy is also kept on your sync server, encrypted with your code.' : 'Nothing is sent to a server.'} Storage is{' '}
          <b>{persisted ? 'persistent' : 'not yet persistent'}</b>.
        </p>
        <div className="row wrap">
          {!persisted && (
            <button onClick={async () => toast((await requestPersistentStorage()) ? 'Storage is now persistent' : 'Declined — try installing the app first')}>
              🔒 Keep my data
            </button>
          )}
          <button onClick={async () => download(await exportEverything())}>💾 Back up all trips</button>
          <button onClick={() => fileRef.current?.click()}>📥 Restore / import</button>
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
                toast(`Imported ${ids.length} trip(s)`)
              } catch (err) {
                toast((err as Error).message)
              }
            }}
          />
        </div>
      </div>

      <div className="card stack">
        <h3>App version</h3>
        <p className="small">
          <b>{__APP_VERSION__}</b>
        </p>
        <p className="small muted">
          Installed apps keep a saved copy and can take a couple of opens to update. If this device behaves differently from another one, compare the version numbers —
          and tap below to load the latest copy. Your trips and settings are not affected.
        </p>
        <div>
          <button onClick={forceUpdate}>🔄 Force update</button>
        </div>
      </div>

      <div className="card stack">
        <h3>Install on your phone</h3>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>
            <b>Android (Chrome):</b> menu ⋮ → <i>Install app</i> (or <i>Add to Home screen</i>).
          </li>
          <li>
            <b>iPhone (Safari):</b> Share button → <i>Add to Home Screen</i>.
          </li>
          <li>Once installed, open each day once while online so maps and weather are cached for offline use.</li>
        </ul>
      </div>

      <div className="card stack">
        <h3>Free services used</h3>
        <p className="small muted">
          Maps © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>, tiles by <a href="https://openfreemap.org">OpenFreeMap</a> · Sights via
          the Overpass API · Walking routes by <a href="https://routing.openstreetmap.de">FOSSGIS OSRM</a> · Place search by Nominatim · Descriptions & photos from
          Wikipedia/Wikidata (CC BY-SA) · Weather by <a href="https://open-meteo.com">Open-Meteo</a> · Exchange rates by <a href="https://frankfurter.dev">Frankfurter</a>{' '}
          (ECB) and <a href="https://www.exchangerate-api.com">Rates By Exchange Rate API</a>. All free for personal use, no accounts or keys.
        </p>
      </div>
    </div>
  )
}
