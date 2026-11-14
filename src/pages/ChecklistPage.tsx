import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import type { ChecklistCategory, ChecklistItem, Item } from '../types'
import { CHECKLIST_CATEGORIES } from '../types'
import { CATEGORY_LABELS, refreshChecklist } from '../lib/checklist'
import { daysBetween, formatDate, today } from '../lib/dates'
import { uid } from '../lib/ids'
import { KIND_META, isTransport } from '../components/kinds'
import { linkLabel } from '../components/PlaceInfo'
import { Empty, Modal, Progress, toast } from '../components/ui'
import { useTripCtx } from './TripLayout'

export default function ChecklistPage() {
  const { trip, items, settings } = useTripCtx()
  const list = useLiveQuery(async () => (await db.checklist.where('tripId').equals(trip.id).toArray()).filter((c) => !c.dismissed), [trip.id])
  const [hideDone, setHideDone] = useState(false)
  const [editing, setEditing] = useState<Partial<ChecklistItem> | null>(null)
  // Bring the checklist in line with the plan every time it's opened: new stays, trains, nights without a bed…
  // (your ticks and your own entries are never touched).
  const refreshed = useRef<string>(undefined)
  useEffect(() => {
    if (refreshed.current === trip.id) return
    refreshed.current = trip.id
    refreshChecklist(trip.id, settings).then(({ added, removed }) => {
      if (added || removed) toast(`Checklist updated from your plan: ${added} added${removed ? `, ${removed} no longer needed` : ''}`)
    })
  }, [trip.id, settings])

  // Booked something on the Plan tab? Tick its "Book: …" entry here.
  useEffect(() => {
    if (!list) return
    const booked = new Set(items.filter((i) => i.status === 'booked' || i.status === 'done').map((i) => i.id))
    const toTick = list.filter((c) => !c.done && c.ruleId?.startsWith('book:') && booked.has(c.ruleId.slice(5)))
    if (toTick.length) db.checklist.bulkUpdate(toTick.map((c) => ({ key: c.id, changes: { done: true } })))
  }, [list, items])

  if (!list) return null

  /** Ticking "Book: <stay or train>" marks that plan item as booked; unticking puts it back to "to book". */
  async function toggle(c: ChecklistItem) {
    await db.checklist.update(c.id, { done: !c.done })
    const itemId = c.ruleId?.startsWith('book:') ? c.ruleId.slice(5) : undefined
    const it = itemId && items.find((i) => i.id === itemId)
    if (!it) return
    if (!c.done && (it.status === 'idea' || it.status === 'planned')) {
      await db.items.update(it.id, { status: 'booked' })
      toast(`${it.title} is now marked as booked in your plan`)
    } else if (c.done && it.status === 'booked') {
      await db.items.update(it.id, { status: 'planned' })
    }
  }

  const done = list.filter((c) => c.done).length
  const now = today()

  async function generate() {
    const { added, removed } = await refreshChecklist(trip.id, settings)
    toast(added || removed ? `${added} added${removed ? `, ${removed} no longer needed` : ''}` : 'Checklist is up to date')
  }

  const itemsById = new Map(items.map((i) => [i.id, i]))
  const byCat = CHECKLIST_CATEGORIES.map((cat) => ({
    cat,
    rows: list
      .filter((c) => c.category === cat && (!hideDone || !c.done))
      .sort((a, b) => Number(a.done) - Number(b.done) || (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9') || a.order - b.order),
  })).filter((g) => g.rows.length)

  return (
    <div className="stack-lg" style={{ maxWidth: 820 }}>
      <div className="card stack">
        <div className="row between wrap">
          <div>
            <h2>Before you go</h2>
            <p className="small muted">
              {done} of {list.length} done
              {trip.startDate > now && ` · ${daysBetween(now, trip.startDate)} days to go`}
            </p>
          </div>
          <div className="row wrap">
            <button onClick={generate}>🔄 Suggest items</button>
            <button className="btn-primary" onClick={() => setEditing({ category: 'other' })}>
              + Add
            </button>
          </div>
        </div>
        <Progress value={done} max={list.length} />
        <label className="inline small">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Hide done
        </label>
        {!settings.nationality && <div className="notice">Set your nationality in Settings to get visa, plug and roaming advice that fits you.</div>}
      </div>

      {list.length === 0 && (
        <div className="card">
          <Empty emoji="✅" title="No checklist yet">
            <p style={{ marginBottom: 12 }}>Generate one from your destinations, travellers and itinerary — it updates as your plan changes.</p>
            <button className="btn-primary" onClick={generate}>
              Generate my checklist
            </button>
          </Empty>
        </div>
      )}

      {byCat.map(({ cat, rows }) => (
        <section key={cat} className="card">
          <div className="card-title">
            <h3>
              {CATEGORY_LABELS[cat].emoji} {CATEGORY_LABELS[cat].label}
            </h3>
            <span className="small muted">
              {rows.filter((r) => r.done).length}/{rows.length}
            </span>
          </div>
          {cat === 'bookings'
            ? BOOKING_GROUPS.map((g) => {
                const groupRows = rows.filter((c) => bookingKind(c, itemsById).group === g.key).sort((x, y) => sortDate(x, itemsById).localeCompare(sortDate(y, itemsById)))
                if (!groupRows.length) return null
                return (
                  <div key={g.key}>
                    <div className="check-group">
                      {g.label} · {groupRows.filter((r) => r.done).length}/{groupRows.length}
                    </div>
                    {groupRows.map((c) => (
                      <CheckRow key={c.id} c={c} icon={bookingKind(c, itemsById).icon} now={now} onToggle={() => toggle(c)} onEdit={() => setEditing(c)} />
                    ))}
                  </div>
                )
              })
            : rows.map((c) => <CheckRow key={c.id} c={c} now={now} onToggle={() => toggle(c)} onEdit={() => setEditing(c)} />)}
        </section>
      ))}

      {editing && <ChecklistEditor tripId={trip.id} item={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

const BOOKING_GROUPS = [
  { key: 'stays', label: '🛏️ Accommodation' },
  { key: 'transport', label: '✈️ Transport' },
  { key: 'tickets', label: '🎟️ Tickets & activities' },
  { key: 'other', label: '📌 Other bookings' },
] as const

/** Which plan item a booking entry is about (from its rule id), to show the right icon and group. */
function bookingKind(c: ChecklistItem, itemsById: Map<string, Item>): { group: (typeof BOOKING_GROUPS)[number]['key']; icon?: string } {
  if (c.ruleId?.startsWith('stay-gap:')) return { group: 'stays', icon: '🛏️' }
  const m = c.ruleId?.match(/^(book|ticket|checkin):(.+)$/)
  const it = m ? itemsById.get(m[2]) : undefined
  if (!it) return { group: 'other' }
  if (it.kind === 'stay') return { group: 'stays', icon: KIND_META.stay.emoji }
  if (isTransport(it.kind)) return { group: 'transport', icon: m![1] === 'checkin' ? '🛂' : KIND_META[it.kind].emoji }
  return { group: 'tickets', icon: KIND_META[it.kind].emoji }
}

/** Bookings follow the trip's order: by the date of the stay, train or ticket (then by due date). */
function sortDate(c: ChecklistItem, itemsById: Map<string, Item>) {
  const gap = c.ruleId?.match(/^stay-gap:(.+)$/)?.[1]
  const it = itemsById.get(c.ruleId?.split(':').slice(1).join(':') ?? '')
  return `${it?.date ?? gap ?? '9999'}${it?.startTime ?? ''}${c.dueDate ?? ''}`
}

function CheckRow({ c, icon, now, onToggle, onEdit }: { c: ChecklistItem; icon?: string; now: string; onToggle: () => void; onEdit: () => void }) {
  const overdue = !c.done && c.dueDate && c.dueDate < now
  return (
    <div className={`check ${c.done ? 'done' : ''}`}>
      <input type="checkbox" checked={c.done} onChange={onToggle} aria-label={c.title} />
      {icon && (
        <span className="check-icon" aria-hidden>
          {icon}
        </span>
      )}
      <div className="grow clickable" onClick={onEdit}>
        <div className="check-title">{c.title}</div>
        {c.notes && <div className="small muted">{c.notes}</div>}
        <div className="row wrap" style={{ gap: 6, marginTop: 2 }}>
          {c.dueDate && (
            <span className={`badge ${overdue ? 'danger' : ''}`}>
              {overdue ? 'Overdue · ' : 'By '}
              {formatDate(c.dueDate)}
            </span>
          )}
          {c.link && (
            <a className="small" href={c.link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
              {c.link.includes('booking.com/searchresults') ? '🔎 Find a place on Booking.com ↗' : `${linkLabel(c.link)} ↗`}
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

function ChecklistEditor({ tripId, item, onClose }: { tripId: string; item: Partial<ChecklistItem>; onClose: () => void }) {
  const [c, setC] = useState(item)
  async function save() {
    if (!c.title?.trim()) return
    await db.checklist.put({
      id: c.id ?? uid(),
      tripId,
      title: c.title.trim(),
      category: (c.category ?? 'other') as ChecklistCategory,
      done: c.done ?? false,
      dueDate: c.dueDate || undefined,
      notes: c.notes || undefined,
      link: c.link || undefined,
      ruleId: c.ruleId,
      // Anything you change on a suggested entry is yours: the refresh must not put the generated text/link back.
      locked: c.locked || (!!c.ruleId && (['title', 'notes', 'link', 'dueDate'] as const).some((k) => (c[k] || undefined) !== (item[k] || undefined))) || undefined,
      order: c.order ?? Date.now(),
    })
    // A link pasted on "Book: <hotel/train…>" also goes on that plan item, where it shows as a button.
    const planItemId = c.ruleId?.startsWith('book:') ? c.ruleId.slice(5) : undefined
    if (planItemId && c.link && c.link !== item.link) await db.items.update(planItemId, { url: c.link })
    onClose()
  }
  async function remove() {
    // Automatic suggestions are hidden rather than deleted, so the next refresh doesn't add them back.
    if (c.id && c.ruleId) await db.checklist.update(c.id, { dismissed: true })
    else if (c.id) await db.checklist.delete(c.id)
    onClose()
  }
  return (
    <Modal title={c.id ? 'Edit item' : 'New checklist item'} onClose={onClose}>
      <div className="stack">
        <label>
          What needs doing?
          <input autoFocus value={c.title ?? ''} onChange={(e) => setC({ ...c, title: e.target.value })} />
        </label>
        <div className="form-grid">
          <label>
            Category
            <select value={c.category} onChange={(e) => setC({ ...c, category: e.target.value as ChecklistCategory })}>
              {CHECKLIST_CATEGORIES.map((k) => (
                <option key={k} value={k}>
                  {CATEGORY_LABELS[k].emoji} {CATEGORY_LABELS[k].label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Do by
            <input type="date" value={c.dueDate ?? ''} onChange={(e) => setC({ ...c, dueDate: e.target.value })} />
          </label>
          <label className="full">
            Link
            <input value={c.link ?? ''} onChange={(e) => setC({ ...c, link: e.target.value })} />
          </label>
          <label className="full">
            Notes
            <textarea style={{ minHeight: 70 }} value={c.notes ?? ''} onChange={(e) => setC({ ...c, notes: e.target.value })} />
          </label>
        </div>
        {c.ruleId && <p className="tiny muted">Suggested automatically from your plan. If you delete it, it won't come back.</p>}
        <div className="row between">
          {c.id ? (
            <button className="btn-ghost btn-danger" onClick={remove}>
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="row">
            <button onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={save}>
              Save
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
