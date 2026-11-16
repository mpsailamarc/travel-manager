import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, requestPersistentStorage } from '../db'
import type { TripDocument } from '../types'
import { bytes } from '../lib/format'
import { uid } from '../lib/ids'
import { useAsync } from '../lib/hooks'
import { Empty, Modal, toast } from '../components/ui'
import { useTripCtx } from './TripLayout'
import { Link } from 'react-router-dom'
import { locale, t, tn } from '../i18n'

export default function DocsPage() {
  const { trip } = useTripCtx()
  const docs = useLiveQuery(() => db.documents.where('tripId').equals(trip.id).toArray(), [trip.id])
  const fileRef = useRef<HTMLInputElement>(null)
  const [viewing, setViewing] = useState<TripDocument | null>(null)
  const { data: persisted } = useAsync(async () => (navigator.storage?.persisted ? navigator.storage.persisted() : false), [docs?.length])

  async function add(files: FileList) {
    for (const f of Array.from(files)) {
      await db.documents.add({ id: uid(), tripId: trip.id, name: f.name, mime: f.type, size: f.size, blob: f, addedAt: Date.now() })
    }
    toast(tn(files.length, 'Saved {n} file on this device', 'Saved {n} files on this device'))
    if (!persisted) await requestPersistentStorage()
  }

  return (
    <div className="stack-lg" style={{ maxWidth: 820 }}>
      <div className="card stack">
        <div className="row between wrap">
          <div>
            <h2>{t('Travel documents')}</h2>
            <p className="small muted">{t('Passport scans, tickets, insurance, booking PDFs. Stored only on this device and available offline.')}</p>
            <p className="small" style={{ margin: 0 }}>
              <Link to="../ideas?tab=bookings">{t('📧 Import a booking email')}</Link>
              <span className="muted"> {t('— paste a confirmation and the flight, hotel or ticket goes into the plan.')}</span>
            </p>
          </div>
          <button className="btn-primary" onClick={() => fileRef.current?.click()}>
            {t('+ Add files')}
          </button>
          <input ref={fileRef} type="file" multiple accept="image/*,application/pdf" hidden onChange={(e) => e.target.files?.length && add(e.target.files)} />
        </div>
        {persisted === false && (
          <div className="notice row wrap between">
            <span>{t('Your browser may clear stored files when space runs low. Allow persistent storage to keep them safe.')}</span>
            <button className="btn-sm" onClick={async () => toast((await requestPersistentStorage()) ? t('Storage is now persistent') : t('The browser declined — installing the app usually helps'))}>
              {t('Keep my files')}
            </button>
          </div>
        )}
      </div>

      {docs && docs.length === 0 && (
        <div className="card">
          <Empty emoji="📄" title={t('No documents yet')}>
            {t('Add photos of passports (photo page), insurance policy, e-tickets and hotel confirmations.')}
          </Empty>
        </div>
      )}

      <div className="grid-3">
        {docs?.map((d) => (
          <div key={d.id} className="card tight row clickable" onClick={() => setViewing(d)}>
            <span style={{ fontSize: '1.8rem' }}>{d.mime.startsWith('image/') ? '🖼️' : d.mime === 'application/pdf' ? '📕' : '📄'}</span>
            <div className="grow">
              <div className="strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {d.name}
              </div>
              <div className="tiny muted">
                {bytes(d.size)} · {new Date(d.addedAt).toLocaleDateString(locale())}
              </div>
            </div>
          </div>
        ))}
      </div>

      {viewing && <DocViewer doc={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

function DocViewer({ doc, onClose }: { doc: TripDocument; onClose: () => void }) {
  const [url] = useState(() => URL.createObjectURL(doc.blob))
  const close = () => {
    URL.revokeObjectURL(url)
    onClose()
  }
  async function remove() {
    if (!confirm(t('Delete {name} from this device?', { name: doc.name }))) return
    await db.documents.delete(doc.id)
    close()
  }
  return (
    <Modal title={doc.name} onClose={close} wide>
      <div className="stack">
        {doc.mime.startsWith('image/') ? (
          <img src={url} alt={doc.name} style={{ maxWidth: '100%', borderRadius: 12 }} />
        ) : doc.mime === 'application/pdf' ? (
          <iframe src={url} title={doc.name} style={{ width: '100%', height: '65dvh', border: 'none', borderRadius: 12 }} />
        ) : (
          <p className="muted">{t('Preview not available.')}</p>
        )}
        <div className="row between">
          <button className="btn-ghost btn-danger" onClick={remove}>
            {t('Delete')}
          </button>
          <a className="btn" href={url} download={doc.name}>
            {t('Open / save')}
          </a>
        </div>
      </div>
    </Modal>
  )
}
