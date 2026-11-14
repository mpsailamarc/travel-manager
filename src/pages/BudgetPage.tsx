import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, touchTrip } from '../db'
import type { BudgetCategory, Expense, ItemKind } from '../types'
import { BUDGET_CATEGORIES } from '../types'
import { BUDGET_LABELS, estimateBudget } from '../lib/budget'
import { fxRate } from '../lib/apis'
import { country } from '../lib/countries'
import { daysBetween, formatDate, today } from '../lib/dates'
import { money } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { Progress, toast } from '../components/ui'
import { QuickExpense } from '../components/QuickExpense'
import { ExpenseEditor } from '../components/ExpenseEditor'
import { useTripCtx } from './TripLayout'

const KIND_TO_CATEGORY: Record<ItemKind, BudgetCategory> = {
  flight: 'flights',
  train: 'transport',
  bus: 'transport',
  car: 'transport',
  ferry: 'transport',
  taxi: 'transport',
  stay: 'stays',
  meal: 'food',
  activity: 'activities',
  walk: 'activities',
  note: 'other',
}

export default function BudgetPage() {
  const { trip, items, settings } = useTripCtx()
  const home = settings.homeCurrency
  const [editing, setEditing] = useState<Expense | null>(null)
  const expenses = useLiveQuery(() => db.expenses.where('tripId').equals(trip.id).toArray(), [trip.id])

  const currencies = [...new Set(items.map((i) => i.cost?.currency).filter((c): c is string => !!c))]
  const { data: rates } = useAsync(
    async () => Object.fromEntries(await Promise.all(currencies.map(async (c) => [c, (await fxRate(c, home)) ?? 1] as const))),
    [currencies.join(), home],
  )

  if (!expenses) return null

  const planned: Record<BudgetCategory, number> = Object.fromEntries(BUDGET_CATEGORIES.map((c) => [c, 0])) as Record<BudgetCategory, number>
  for (const it of items) {
    if (!it.cost?.amount || it.status === 'skipped') continue
    planned[KIND_TO_CATEGORY[it.kind]] += it.cost.amount * (rates?.[it.cost.currency] ?? 1)
  }
  // Bookings with a reference are treated as paid in advance; expenses are what you pay on the spot.
  const spent: Record<BudgetCategory, number> = Object.fromEntries(BUDGET_CATEGORIES.map((c) => [c, 0])) as Record<BudgetCategory, number>
  let prepaid = 0
  for (const it of items) {
    if (!it.bookingRef || !it.cost?.amount || it.status === 'skipped') continue
    const v = it.cost.amount * (rates?.[it.cost.currency] ?? 1)
    spent[KIND_TO_CATEGORY[it.kind]] += v
    prepaid += v
  }
  for (const e of expenses) spent[e.category] += e.amountHome

  const totalBudget = BUDGET_CATEGORIES.reduce((s, c) => s + (trip.budget[c] ?? 0), 0)
  const totalPlanned = BUDGET_CATEGORIES.reduce((s, c) => s + planned[c], 0)
  const totalSpent = BUDGET_CATEGORIES.reduce((s, c) => s + spent[c], 0)
  const onTrip = totalSpent - prepaid
  const now = today()
  const daysLeft = now >= trip.startDate && now <= trip.endDate ? daysBetween(now, trip.endDate) + 1 : undefined

  async function estimate() {
    if (totalBudget && !confirm('Replace your current budget with a rough estimate?')) return
    const b = await estimateBudget(trip, settings.nationality, home)
    await db.trips.update(trip.id, { budget: b })
    await touchTrip(trip.id)
    toast('Rough estimate filled in — adjust as you book')
  }

  async function setBudget(c: BudgetCategory, v: number) {
    await db.trips.update(trip.id, { budget: { ...trip.budget, [c]: v || undefined } })
  }

  const byDate = [...expenses].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)

  return (
    <div className="stack-lg">
      <div className="info-grid">
        <Kpi k="Budget" v={money(totalBudget, home)} />
        <Kpi k="In the plan" v={money(totalPlanned, home)} sub="costs on itinerary items" />
        <Kpi k="Spent" v={money(totalSpent, home)} sub={`${money(prepaid, home)} booked ahead · ${money(onTrip, home)} on the trip`} />
        <Kpi
          k="Left"
          v={money(totalBudget - totalSpent, home)}
          sub={daysLeft ? `${money((totalBudget - totalSpent) / daysLeft, home)}/day for ${daysLeft} days` : undefined}
          warn={totalBudget > 0 && totalSpent > totalBudget}
        />
      </div>

      <div className="grid-2 wide-left">
        <div className="card">
          <div className="card-title">
            <h3>By category</h3>
            <button className="btn-sm" onClick={estimate}>
              🧮 Estimate for me
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th className="num">Budget ({home})</th>
                <th className="num hide-mobile">In plan</th>
                <th className="num" title="Bookings paid ahead + expenses">Spent</th>
              </tr>
            </thead>
            <tbody>
              {BUDGET_CATEGORIES.map((c) => {
                const b = trip.budget[c] ?? 0
                return (
                  <tr key={c}>
                    <td>
                      <div>
                        {BUDGET_LABELS[c].emoji} {BUDGET_LABELS[c].label}
                      </div>
                      {b > 0 && (
                        <div style={{ marginTop: 4 }}>
                          <Progress value={Math.max(spent[c], 0)} max={b} over={spent[c] > b} />
                        </div>
                      )}
                    </td>
                    <td className="num">
                      <input
                        type="number"
                        min={0}
                        style={{ width: 100, textAlign: 'right' }}
                        defaultValue={b || ''}
                        key={`${c}-${b}`}
                        onBlur={(e) => setBudget(c, Number(e.target.value))}
                      />
                    </td>
                    <td className="num hide-mobile muted">{planned[c] ? money(planned[c], home) : '—'}</td>
                    <td className="num">{spent[c] ? money(spent[c], home) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="tiny muted" style={{ marginTop: 8 }}>
            <b>Spent</b> = bookings that have a booking reference (paid ahead) + expenses you log. <b>Estimate for me</b> uses typical daily costs for the destination,
            your budget level and group size — a starting point; the AI ideas include a more specific budget.
          </p>
        </div>

        <div className="stack">
          <QuickExpense tripId={trip.id} home={home} local={country(trip.countryCodes[0])?.currency ?? home} />
          <div className="card">
            <h3 style={{ marginBottom: 8 }}>Expenses</h3>
            {byDate.length === 0 && <p className="small muted">Nothing logged yet. Log what you spend above as you go.</p>}
            <table>
              <tbody>
                {byDate.map((e) => (
                  <tr key={e.id} className="clickable" onClick={() => setEditing(e)}>
                    <td className="small muted nowrap">{formatDate(e.date, { day: 'numeric', month: 'short' })}</td>
                    <td>
                      {BUDGET_LABELS[e.category].emoji} {e.note ?? BUDGET_LABELS[e.category].label}
                    </td>
                    <td className="num">
                      {money(e.amount, e.currency, 2)}
                      {e.currency !== home && <div className="tiny muted">{money(e.amountHome, home, 2)}</div>}
                    </td>
                    <td style={{ width: 64 }} className="nowrap">
                      <button
                        className="icon-btn"
                        aria-label="Edit"
                        onClick={(ev) => {
                          ev.stopPropagation()
                          setEditing(e)
                        }}
                      >
                        ✏️
                      </button>
                      <button
                        className="icon-btn"
                        aria-label="Delete"
                        onClick={(ev) => {
                          ev.stopPropagation()
                          if (confirm(`Delete this expense (${money(e.amount, e.currency, 2)})?`)) db.expenses.delete(e.id)
                        }}
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {editing && <ExpenseEditor expense={editing} home={home} onClose={() => setEditing(null)} />}
    </div>
  )
}

function Kpi({ k, v, sub, warn }: { k: string; v: string; sub?: string; warn?: boolean }) {
  return (
    <div className="card tight">
      <div className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {k}
      </div>
      <div style={{ fontSize: '1.4rem', fontWeight: 700, color: warn ? 'var(--danger)' : undefined }}>{v}</div>
      {sub && <div className="tiny muted">{sub}</div>}
    </div>
  )
}
