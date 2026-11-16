import { useNavigate } from 'react-router-dom'
import { db } from '../db'
import type { Trip } from '../types'
import { planChanges, planInputs } from '../lib/planbasis'
import { t } from '../i18n'

/**
 * "You changed the dates and the pace since this itinerary was made": offers new itinerary ideas for the trip as it is now,
 * or to keep the plan as it is (which stops the notice).
 */
export function PlanStaleNotice({ trip }: { trip: Trip }) {
  const navigate = useNavigate()
  const changes = planChanges(trip)
  if (!changes.length) return null
  return (
    <div className="notice row wrap between" style={{ gap: 8 }}>
      <span>
        {t('✏️ You changed the')} <b>{changes.map((c) => t(c)).join(', ')}</b> {t('since this itinerary was made, so it may not fit any more.')}
      </span>
      <span className="row" style={{ gap: 6 }}>
        <button className="btn-sm btn-primary" onClick={() => navigate(`/trip/${trip.id}/ideas?fresh=1`)}>
          {t('✨ New itinerary ideas')}
        </button>
        <button className="btn-sm" onClick={() => db.trips.update(trip.id, { planBasis: planInputs(trip) })}>
          {t('Keep this plan')}
        </button>
      </span>
    </div>
  )
}
