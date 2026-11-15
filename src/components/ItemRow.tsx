import type { ReactNode } from 'react'
import type { Item } from '../types'
import { KIND_META, isTransport, needsBooking } from './kinds'
import { StatusBadge } from './ui'
import { linkLabel } from './PlaceInfo'
import { money, distance, plural } from '../lib/format'
import { formatDuration } from '../lib/dates'
import { legText } from '../lib/legs'

export function itemSubtitle(it: Item): string {
  const parts: string[] = []
  if (isTransport(it.kind) && (it.from?.name || it.to?.name)) parts.push(`${it.from?.name ?? '?'} → ${it.to?.name ?? '?'}`)
  if (it.endTime) parts.push(`until ${it.endTime}`)
  if (it.kind === 'stay' && it.nights) parts.push(plural(it.nights, 'night'))
  if (!isTransport(it.kind) && it.kind !== 'walk' && it.location?.name && it.location.name !== it.title) parts.push(it.location.name)
  if (it.walk) parts.push(`${it.walk.stops.length} stops · ${distance(it.walk.distanceM)} · ${formatDuration(it.walk.walkS)} walking`)
  if (it.bookingRef) parts.push(`Ref ${it.bookingRef}`)
  if (it.cost?.amount) parts.push(money(it.cost.amount, it.cost.currency))
  return parts.join(' · ')
}

export function ItemRow({ item, onClick, actions, showStatus = true, zoneNote, pin, onPin }: { item: Item; onClick?: () => void; actions?: ReactNode; showStatus?: boolean; zoneNote?: string; pin?: number; onPin?: () => void }) {
  const meta = KIND_META[item.kind]
  return (
    <div className={`item ${item.status === 'done' ? 'is-done' : ''} ${item.status === 'skipped' ? 'is-skipped' : ''}`}>
      <div className="item-time">{item.startTime ?? ''}</div>
      <div className={`item-icon ${meta.cls}`} aria-hidden>
        {meta.emoji}
      </div>
      <div className={`item-main ${onClick ? 'clickable' : ''}`} onClick={onClick}>
        <div className="row wrap" style={{ gap: 6 }}>
          {pin != null && (
            <button type="button" className="pin" title="Show on the day's map" aria-label={`Stop ${pin} on the map`} onClick={(e) => { e.stopPropagation(); onPin?.() }}>
              {pin}
            </button>
          )}
          <span className="item-title">{item.title}</span>
          {showStatus && item.status !== 'planned' && <StatusBadge status={item.status} />}
          {showStatus && item.status === 'planned' && needsBooking(item.kind) && <StatusBadge status="planned" />}
          {item.kind === 'drive' && <span className="badge">Self-drive · no booking</span>}
        </div>
        {itemSubtitle(item) && <div className="item-sub">{itemSubtitle(item)}</div>}
        {zoneNote && <div className="item-sub">🌏 {zoneNote}</div>}
        {item.legIn && (
          <div className="item-sub">
            {legText(item.legIn, distance)}
            {item.legIn.fromName ? ` from ${item.legIn.fromName}` : ''}
          </div>
        )}
        {item.notes && <div className="item-sub">{item.notes}</div>}
        {item.url && (
          <a className="item-sub" href={item.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ display: 'inline-block', marginTop: 2 }}>
            {linkLabel(item.url)}
          </a>
        )}
      </div>
      {actions && <div className="item-actions">{actions}</div>}
    </div>
  )
}
