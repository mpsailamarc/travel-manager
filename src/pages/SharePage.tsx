import { useState } from 'react'
import { exportTrip, shareOrDownload } from '../lib/share'
import { toast } from '../components/ui'
import { t } from '../i18n'
import { useTripCtx } from './TripLayout'

export default function SharePage() {
  const { trip } = useTripCtx()
  const [docs, setDocs] = useState(false)
  const [expenses, setExpenses] = useState(false)
  const [busy, setBusy] = useState(false)

  async function go() {
    setBusy(true)
    try {
      const file = await exportTrip(trip.id, { documents: docs, expenses })
      const how = await shareOrDownload(file)
      if (how === 'downloaded') toast(t('Saved {name}', { name: file.name }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack-lg" style={{ maxWidth: 720 }}>
      <div className="card stack">
        <h2>{t('Share this trip')}</h2>
        <p className="small">
          {t('One file:')} <code>.trip.json</code>. {t('Send it by WhatsApp, email or AirDrop; the other person opens this app, taps Import on the home screen, and gets their own copy of the plan — fully offline. No account, no server, no cost.')}
        </p>
        <label className="inline">
          <input type="checkbox" checked={expenses} onChange={(e) => setExpenses(e.target.checked)} /> {t('Include expenses')}
        </label>
        <label className="inline">
          <input type="checkbox" checked={docs} onChange={(e) => setDocs(e.target.checked)} /> {t('Include documents (passport scans etc.)')}
        </label>
        {docs && <div className="notice">{t('Documents may contain personal data such as passport details — only share them with people you trust, over a private channel.')}</div>}
        <div>
          <button className="btn-primary" onClick={go} disabled={busy}>
            📤 {busy ? t('Preparing…') : t('Share / download trip file')}
          </button>
        </div>
      </div>
      <div className="card stack">
        <h3>{t('Good to know')}</h3>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>{t('Each person gets an independent copy. If you change the plan, share the file again (importing creates a new copy).')}</li>
          <li>{t('For a printed or PDF version, use Print on the Plan tab.')}</li>
          <li>{t('Back up everything (all trips) from Settings.')}</li>
        </ul>
      </div>
    </div>
  )
}
