import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db, deleteTrip, extendTripDays } from '../db'
import type { Trip } from '../types'
import { Modal, toast } from '../components/ui'
import { locatePlace } from '../lib/apis'
import { adjustBasisToTrip, adjustLinesToTrip, adjustPlanBudgetToTrip, budgetFromLines, scaleCostsForGroup } from '../lib/budget'
import { TripFields } from './TripFields'

export function TripDetailsModal({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const [draft, setDraft] = useState<Trip>(trip)
  const [saving, setSaving] = useState(false)
  const navigate = useNavigate()

  async function save() {
    if (draft.endDate < draft.startDate) {
      toast('The end date is before the start date')
      return
    }
    if (saving) return
    setSaving(true)
    // A start/return typed without tapping "Find" still gets located, so it shows on the map.
    const startPlace = await locatePlace(draft.startPlace)
    const endPlace = draft.endPlace?.name ? await locatePlace(draft.endPlace) : undefined
    // The dates saved here are yours: an itinerary idea no longer counts as having stretched them.
    // More or fewer travellers, other dates: the budget follows. The estimate's lines and its "How this was estimated" note,
    // figures from an itinerary idea, and the estimated (not booked) prices of plan items.
    const budgetLines = draft.budgetLines ? adjustLinesToTrip(draft.budgetLines, trip, draft) : undefined
    const linesChanged = !!budgetLines && budgetLines !== draft.budgetLines
    const budget = adjustPlanBudgetToTrip(linesChanged ? budgetFromLines(budgetLines!, draft.budget, draft.budgetLines) : draft.budget, draft.planBudget, budgetLines, trip, draft)
    const budgetBasis = linesChanged ? adjustBasisToTrip(draft.budgetBasis, draft) : draft.budgetBasis
    const prices = scaleCostsForGroup(await db.items.where('tripId').equals(trip.id).toArray(), trip, draft)
    await db.trips.put({ ...draft, budgetLines, budget, budgetBasis, startPlace, endPlace, userEndDate: undefined, updatedAt: Date.now() })
    if (prices.length) await db.items.bulkUpdate(prices.map((p) => ({ key: p.id, changes: { cost: p.cost } })))
    await extendTripDays(trip.id, trip, draft)
    const changed = linesChanged || prices.length > 0 || budget !== draft.budget
    toast(changed ? `Trip saved · budget updated for the new group and dates${prices.length ? ` (${prices.length} estimated price${prices.length > 1 ? 's' : ''} in the plan too)` : ''}` : 'Trip saved')
    onClose()
  }

  async function remove() {
    if (!confirm(`Delete "${trip.name}" and everything in it (plan, checklist, expenses, documents)? This can't be undone.`)) return
    await deleteTrip(trip.id)
    navigate('/')
  }

  return (
    <Modal title="Trip details" onClose={onClose} wide>
      <div className="stack">
        <TripFields value={draft} onChange={setDraft} />
        <div className="row between">
          <button className="btn-ghost btn-danger" onClick={remove}>
            Delete trip
          </button>
          <div className="row">
            <button onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
