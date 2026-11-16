import { useState } from 'react'
import { defaultServer, disableSync, enableSync, getConfig, newCode, syncNow, useSyncStatus, type SyncStatus } from '../lib/sync'
import { copyText, toast } from './ui'
import { locale, t } from '../i18n'

export function syncLabel(s: SyncStatus): string {
  switch (s.state) {
    case 'off':
      return t('Sync is off')
    case 'syncing':
      return t('Syncing…')
    case 'offline':
      return t('Offline — will sync when back online')
    case 'error':
      return s.message
    case 'idle':
      return s.lastSync ? t('Synced {when}', { when: ago(s.lastSync) }) : t('Ready to sync')
  }
}

function ago(at: number) {
  const s = Math.round((Date.now() - at) / 1000)
  if (s < 60) return t('just now')
  if (s < 3600) return t('{n} min ago', { n: Math.round(s / 60) })
  if (s < 86400) return t('{n} h ago', { n: Math.round(s / 3600) })
  return new Date(at).toLocaleString(locale())
}

export function SyncCard() {
  const status = useSyncStatus()
  const cfg = getConfig()
  const [mode, setMode] = useState<'new' | 'join'>()
  const [code, setCode] = useState('')
  const [server, setServer] = useState(defaultServer())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [showCode, setShowCode] = useState(false)

  async function start(c: string) {
    setBusy(true)
    setError(undefined)
    try {
      await enableSync(c, server)
      toast(t('Sync is on'))
      setMode(undefined)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (cfg) {
    return (
      <div className="card stack">
        <div className="row between wrap">
          <h3>{t('☁️ Sync between devices')}</h3>
          <span className={`badge ${status.state === 'error' ? 'danger' : status.state === 'idle' ? 'booked' : ''}`}>{status.state === 'idle' ? t('On') : t(status.state)}</span>
        </div>
        <p className="small">{syncLabel(status)}</p>
        <p className="small muted">
          {t('Trips, plans, checklists, expenses, backup ideas and your settings sync automatically with every device using the same code. Documents stay on each device.')}
        </p>
        <div className="row wrap">
          <button onClick={() => syncNow()} disabled={status.state === 'syncing'}>
            {t('🔄 Sync now')}
          </button>
          <button onClick={() => setShowCode((s) => !s)}>{showCode ? t('Hide code') : t('🔑 Show sync code')}</button>
          <button
            className="btn-ghost btn-danger"
            onClick={async () => {
              if (!confirm(t('Stop syncing on this device? Your trips stay here, and the other devices keep their copies.'))) return
              await disableSync()
              toast(t('Sync turned off on this device'))
            }}
          >
            {t('Turn off here')}
          </button>
        </div>
        {showCode && (
          <div className="stack" style={{ gap: 6 }}>
            <div className="row">
              <code className="grow" style={{ fontSize: '1rem', letterSpacing: '0.05em', wordBreak: 'break-all' }}>
                {cfg.code}
              </code>
              <button className="btn-sm" onClick={() => copyText(cfg.code)}>
                {t('Copy')}
              </button>
            </div>
            <p className="tiny muted">{t('Enter this code on your other devices (Settings → Sync → I have a code). Anyone with it can see and change these trips.')}</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="card stack">
      <h3>{t('☁️ Sync between devices')}</h3>
      <p className="small">
        {t("Keep your computer, phone (and family) in sync automatically, through your own PythonAnywhere site. Your data is encrypted on the device with a sync code before it's sent — the server can't read it. Documents (passport scans) stay on each device.")}
      </p>
      {!mode && (
        <div className="row wrap">
          <button
            className="btn-primary"
            onClick={() => {
              setCode(newCode())
              setMode('new')
            }}
          >
            {t('Set up sync (first device)')}
          </button>
          <button onClick={() => setMode('join')}>{t('I have a code')}</button>
        </div>
      )}

      {mode === 'new' && (
        <div className="stack" style={{ gap: 8 }}>
          <p className="small">
            {t('Your sync code —')} <b>{t('save it somewhere safe')}</b> {t("(e.g. a note or your password manager) and use it on your other devices. Without it, the synced copy can't be recovered.")}
          </p>
          <div className="row">
            <code className="grow" style={{ fontSize: '1.05rem', letterSpacing: '0.05em', wordBreak: 'break-all' }}>
              {code}
            </code>
            <button className="btn-sm" onClick={() => copyText(code)}>
              {t('Copy')}
            </button>
          </div>
        </div>
      )}

      {mode === 'join' && (
        <label>
          {t('Sync code from your other device')}
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="TRVL-XXXX-XXXX-…" autoCapitalize="characters" autoComplete="off" />
        </label>
      )}

      {mode && (
        <>
          <details>
            <summary className="small muted">{t('Server address')}</summary>
            <label style={{ marginTop: 6 }}>
              {t('Sync API')}
              <input value={server} onChange={(e) => setServer(e.target.value)} />
            </label>
            <p className="tiny muted">{t('Normally the site this app is opened from. Change it only if your sync server lives elsewhere.')}</p>
          </details>
          {error && <div className="notice error">{error}</div>}
          {mode === 'join' && <p className="tiny muted">{t('Trips already on this device are merged with the synced ones.')}</p>}
          <div className="row">
            <button onClick={() => setMode(undefined)}>{t('Cancel')}</button>
            <button className="btn-primary" disabled={busy || !code.trim()} onClick={() => start(code)}>
              {busy ? t('Connecting…') : mode === 'new' ? t('I saved it — turn on sync') : t('Turn on sync')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
