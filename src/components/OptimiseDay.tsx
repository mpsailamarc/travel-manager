import { useState } from 'react'
import type { Settings } from '../types'
import { applyProposal, proposeDay, type DayProposal } from '../lib/favorites'
import { formatDuration } from '../lib/dates'
import { distance } from '../lib/format'
import { legText } from '../lib/legs'
import { hoursWarning } from '../lib/hours'
import { Modal, toast } from './ui'
import { t } from '../i18n'

/**
 * "🔀 Optimise this day": works out a better order for everything that can move (not 📌 locked, booked, journeys or stays),
 * shows it with the travel saved, and saves it only when you say so.
 */
export function OptimiseDayButton({ tripId, date, settings, className = 'btn-sm' }: { tripId: string; date: string; settings: Settings; className?: string }) {
  const [busy, setBusy] = useState(false)
  const [proposal, setProposal] = useState<DayProposal | null>()

  async function run() {
    setBusy(true)
    try {
      const p = await proposeDay(tripId, date, settings)
      if (!p) toast(t('Nothing on this day can move: everything is 📌 locked, booked or a journey.'))
      else setProposal(p)
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!proposal) return
    await applyProposal(proposal)
    toast(proposal.travelAfter < proposal.travelBefore ? t('Day optimised · {duration} less travel', { duration: formatDuration((proposal.travelBefore - proposal.travelAfter) * 60) }) : t('Day reorganised'))
    setProposal(undefined)
  }

  const saved = proposal ? proposal.travelBefore - proposal.travelAfter : 0
  return (
    <>
      <button className={className} disabled={busy} onClick={run} title={t('Reorder what can move to cut travel')}>
        {busy ? t('⏳ Optimising…') : t('🔀 Optimise')}
      </button>
      {proposal && (
        <Modal title={t('🔀 Optimise this day')} onClose={() => setProposal(undefined)}>
          <div className="stack">
            {proposal.changes.length === 0 ? (
              <div className="notice info">{t('This day is already in a good order. Nothing to change.')}</div>
            ) : (
              <div className={`notice ${saved > 0 ? 'info' : ''}`}>
                {t('Travel between places:')} <b>{formatDuration(proposal.travelBefore * 60)}</b> → <b>{formatDuration(proposal.travelAfter * 60)}</b>
                {saved > 0 ? ` · ${t('saves {duration}', { duration: formatDuration(saved * 60) })}` : saved < 0 ? ` · ${t('a little more travel, but it fits around what is fixed')}` : ''}
              </div>
            )}
            <ol className="route-list">
              {proposal.order.map((o, n) => (
                <li key={o.item.id} className="route-stop" style={{ cursor: 'default' }}>
                  <span className="pin" style={{ background: o.moved ? 'var(--primary)' : '#a8a29e' }}>{n + 1}</span>
                  <span className="grow">
                    <b className="small">
                      {o.startTime}
                      {o.endTime ? `–${o.endTime}` : ''} · {o.item.title}
                    </b>
                    <span className="tiny muted" style={{ display: 'block' }}>
                      {o.moved ? t('was {time}', { time: o.item.startTime ?? t('without a time') }) : t('📌 stays')}
                      {o.moved && o.leg && ` · ${legText(o.leg, distance)}`}
                    </span>
                    {hoursWarning({ ...o.item, startTime: o.startTime, endTime: o.endTime }, o.item.date) && (
                      <span className="tiny" style={{ display: 'block', color: '#b45309' }}>
                        🕘 {hoursWarning({ ...o.item, startTime: o.startTime, endTime: o.endTime }, o.item.date)}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
            {proposal.changes.some((c) => !c.startTime) && (
              <p className="small muted">{t('{titles}: no time left that day, so they stay on it without a time.', { titles: proposal.changes.filter((c) => !c.startTime).map((c) => c.item.title).join(', ') })}</p>
            )}
            <p className="tiny muted">
              {t('Locked (📌), booked items, journeys and your hotel never move. Lock anything else from its ⋯ menu or its form. Sights are kept within their opening hours where possible: the published ones when OpenStreetMap has them, otherwise 9:00–17:00 (parks, viewpoints, markets and walks have no limit).')}
            </p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button onClick={() => setProposal(undefined)}>{t('Keep as is')}</button>
              <button className="btn-primary" disabled={!proposal.changes.length} onClick={apply}>
                {t('Apply')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
