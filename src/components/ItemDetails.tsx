import type { Item } from '../types'
import { KIND_META, needsBooking } from './kinds'
import { itemSubtitle } from './ItemRow'
import { PlaceInfo } from './PlaceInfo'
import { Modal, StatusBadge } from './ui'

/** Read view of a plan item for when you're out and about: what it is, where, links — with Edit one tap away. */
export function ItemDetails({ item, city, onEdit, onClose }: { item: Item; city?: string; onEdit: () => void; onClose: () => void }) {
  const meta = KIND_META[item.kind]
  return (
    <Modal
      title={
        <span>
          {meta.emoji} {item.title}
        </span>
      }
      onClose={onClose}
    >
      <div className="stack">
        <div className="row wrap" style={{ gap: 8 }}>
          {item.startTime && (
            <b>
              {item.startTime}
              {item.endTime && `–${item.endTime}`}
            </b>
          )}
          {(item.status !== 'planned' || needsBooking(item.kind)) && <StatusBadge status={item.status} />}
          {item.bookingRef && (
            <span className="small">
              Ref <b style={{ fontFamily: 'ui-monospace, monospace', letterSpacing: '0.05em' }}>{item.bookingRef}</b>
            </span>
          )}
        </div>
        {itemSubtitle(item) && <p className="small muted">{itemSubtitle(item)}</p>}
        {item.notes && <p className="small">{item.notes}</p>}
        <hr />
        <PlaceInfo item={item} city={city} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={onClose}>Close</button>
          <button className="btn-primary" onClick={onEdit}>
            ✏️ Edit
          </button>
        </div>
      </div>
    </Modal>
  )
}
