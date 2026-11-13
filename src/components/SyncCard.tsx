import { useState } from 'react'
import { defaultServer, disableSync, enableSync, getConfig, newCode, syncNow, useSyncStatus, type SyncStatus } from '../lib/sync'
import { copyText, toast } from './ui'

export function syncLabel(s: SyncStatus): string {
  switch (s.state) {
    case 'off':
      return 'Sync is off'
    case 'syncing':
      return 'Syncing…'
    case 'offline':
      return 'Offline — will sync when back online'
    case 'error':
      return s.message
    case 'idle':
      return s.lastSync ? `Synced ${ago(s.lastSync)}` : 'Ready to sync'
  }
}

function ago(t: number) {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(t).toLocaleString()
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
      toast('Sync is on')
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
          <h3>☁️ Sync between devices</h3>
          <span className={`badge ${status.state === 'error' ? 'danger' : status.state === 'idle' ? 'booked' : ''}`}>{status.state === 'idle' ? 'On' : status.state}</span>
        </div>
        <p className="small">{syncLabel(status)}</p>
        <p className="small muted">
          Trips, plans, checklists, expenses and favourites sync automatically with every device using the same code. Documents stay on each device.
        </p>
        <div className="row wrap">
          <button onClick={() => syncNow()} disabled={status.state === 'syncing'}>
            🔄 Sync now
          </button>
          <button onClick={() => setShowCode((s) => !s)}>{showCode ? 'Hide code' : '🔑 Show sync code'}</button>
          <button
            className="btn-ghost btn-danger"
            onClick={async () => {
              if (!confirm('Stop syncing on this device? Your trips stay here, and the other devices keep their copies.')) return
              await disableSync()
              toast('Sync turned off on this device')
            }}
          >
            Turn off here
          </button>
        </div>
        {showCode && (
          <div className="stack" style={{ gap: 6 }}>
            <div className="row">
              <code className="grow" style={{ fontSize: '1rem', letterSpacing: '0.05em', wordBreak: 'break-all' }}>
                {cfg.code}
              </code>
              <button className="btn-sm" onClick={() => copyText(cfg.code)}>
                Copy
              </button>
            </div>
            <p className="tiny muted">Enter this code on your other devices (Settings → Sync → I have a code). Anyone with it can see and change these trips.</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="card stack">
      <h3>☁️ Sync between devices</h3>
      <p className="small">
        Keep your computer, phone (and family) in sync automatically, through your own PythonAnywhere site. Your data is encrypted on the device with a sync code before it's
        sent — the server can't read it. Documents stay on each device.
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
            Set up sync (first device)
          </button>
          <button onClick={() => setMode('join')}>I have a code</button>
        </div>
      )}

      {mode === 'new' && (
        <div className="stack" style={{ gap: 8 }}>
          <p className="small">
            Your sync code — <b>save it somewhere safe</b> (e.g. a note or your password manager) and use it on your other devices. Without it, the synced copy can't be
            recovered.
          </p>
          <div className="row">
            <code className="grow" style={{ fontSize: '1.05rem', letterSpacing: '0.05em', wordBreak: 'break-all' }}>
              {code}
            </code>
            <button className="btn-sm" onClick={() => copyText(code)}>
              Copy
            </button>
          </div>
        </div>
      )}

      {mode === 'join' && (
        <label>
          Sync code from your other device
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="TRVL-XXXX-XXXX-…" autoCapitalize="characters" autoComplete="off" />
        </label>
      )}

      {mode && (
        <>
          <details>
            <summary className="small muted">Server address</summary>
            <label style={{ marginTop: 6 }}>
              Sync API
              <input value={server} onChange={(e) => setServer(e.target.value)} />
            </label>
            <p className="tiny muted">Normally the site this app is opened from. Change it only if your sync server lives elsewhere.</p>
          </details>
          {error && <div className="notice error">{error}</div>}
          {mode === 'join' && <p className="tiny muted">Trips already on this device are merged with the synced ones.</p>}
          <div className="row">
            <button onClick={() => setMode(undefined)}>Cancel</button>
            <button className="btn-primary" disabled={busy || !code.trim()} onClick={() => start(code)}>
              {busy ? 'Connecting…' : mode === 'new' ? 'I saved it — turn on sync' : 'Turn on sync'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
