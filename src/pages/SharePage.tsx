import { useState } from 'react'
import { exportTrip, shareOrDownload } from '../lib/share'
import { toast } from '../components/ui'
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
      if (how === 'downloaded') toast(`Saved ${file.name}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack-lg" style={{ maxWidth: 720 }}>
      <div className="card stack">
        <h2>Share this trip</h2>
        <p className="small">
          Creates a single <code>.trip.json</code> file. Send it by WhatsApp, email or AirDrop; the other person opens this app, taps <b>Import</b> on the home screen,
          and gets their own copy of the plan — fully offline. No account, no server, no cost.
        </p>
        <label className="inline">
          <input type="checkbox" checked={expenses} onChange={(e) => setExpenses(e.target.checked)} /> Include expenses
        </label>
        <label className="inline">
          <input type="checkbox" checked={docs} onChange={(e) => setDocs(e.target.checked)} /> Include documents (passport scans etc.)
        </label>
        {docs && <div className="notice">Documents may contain personal data such as passport details — only share them with people you trust, over a private channel.</div>}
        <div>
          <button className="btn-primary" onClick={go} disabled={busy}>
            📤 {busy ? 'Preparing…' : 'Share / download trip file'}
          </button>
        </div>
      </div>
      <div className="card stack">
        <h3>Good to know</h3>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Each person gets an independent copy. If you change the plan, share the file again (importing creates a new copy).</li>
          <li>For a printed or PDF version, use Print on the Plan tab.</li>
          <li>Back up everything (all trips) from Settings.</li>
        </ul>
      </div>
    </div>
  )
}
