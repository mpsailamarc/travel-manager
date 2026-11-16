import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db, deleteTrip, extendTripDays } from '../db'
import type { Trip } from '../types'
import { Modal, toast } from '../components/ui'
import { locatePlace } from '../lib/apis'
import { syncBudgetToTrip } from '../lib/budget'
import { TripFields } from './TripFields'
import { duplicateTrip } from '../lib/share'

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
    await db.trips.put({ ...draft, startPlace, endPlace, userEndDate: undefined, updatedAt: Date.now() })
    await extendTripDays(trip.id, trip, draft)
    // Other dates, budget level or destination: the budget follows (who is travelling is changed in the Budget tab).
    const synced = await syncBudgetToTrip(trip, { ...draft, startPlace, endPlace })
    toast(synced.lines || synced.prices ? 'Trip saved · budget updated' : 'Trip saved')
    onClose()
  }

  // A copy to try things on: change the dates, cities or pace there and compare, the original stays as it is.
  async function duplicate() {
    const name = prompt('Name of the copy', `${trip.name} (copy)`)
    if (!name?.trim()) return
    const id = await duplicateTrip(trip.id, name.trim())
    toast(`📄 “${name.trim()}” created: a copy to try things on, the original is unchanged`)
    navigate(`/trip/${id}/plan`)
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
          <div className="row">
            <button className="btn-ghost btn-danger" onClick={remove}>
              Delete trip
            </button>
            <button className="btn-ghost" onClick={duplicate} title="A copy of this trip to try other dates, cities or pace">
              📄 Duplicate
            </button>
          </div>
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
