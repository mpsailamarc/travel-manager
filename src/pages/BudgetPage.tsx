import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, touchTrip } from '../db'
import type { BudgetCategory, BudgetLine, Expense, ItemKind } from '../types'
import { BUDGET_CATEGORIES } from '../types'
import { BUDGET_LABELS, budgetFromLines, estimateBudgetLines } from '../lib/budget'
import { fxRate } from '../lib/apis'
import { country } from '../lib/countries'
import { daysBetween, formatDate, today } from '../lib/dates'
import { money, plural } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { Progress, Section, toast } from '../components/ui'
import { uid } from '../lib/ids'
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
  const [linesOpen, setLinesOpen] = useState(true)
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

  const lines = trip.budgetLines ?? []
  const hasLines = (c: BudgetCategory) => lines.some((l) => l.category === c)

  /** Saves the breakdown and re-derives the category totals from it. */
  async function saveLines(next: BudgetLine[]) {
    await db.trips.update(trip.id, { budgetLines: next.length ? next : undefined, budget: budgetFromLines(next, trip.budget, lines) })
    await touchTrip(trip.id)
  }

  async function estimate() {
    if ((totalBudget || lines.length) && !confirm('Replace your current budget with a new rough estimate?')) return
    const next = await estimateBudgetLines(trip, settings.nationality, home)
    // A fresh estimate replaces everything: categories it has no lines for (e.g. flights) are cleared.
    await db.trips.update(trip.id, { budgetLines: next, budget: budgetFromLines(next, {}, []) })
    await touchTrip(trip.id)
    toast('Estimate filled in — change or remove any line below')
  }

  /** Adding the first line to a category that had a typed-in budget keeps that amount as a line, so nothing is lost. */
  async function addLine(c: BudgetCategory) {
    const keep = !hasLines(c) && trip.budget[c] ? [{ id: uid(), category: c, label: 'Your earlier budget', amount: trip.budget[c]! }] : []
    await saveLines([...lines, ...keep, { id: uid(), category: c, label: '', amount: 0 }])
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
                      {hasLines(c) ? (
                        <span title="Adds up the lines in the breakdown below">{money(b, home)}</span>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          style={{ width: 100, textAlign: 'right' }}
                          defaultValue={b || ''}
                          key={`${c}-${b}`}
                          onBlur={(e) => setBudget(c, Number(e.target.value))}
                        />
                      )}
                    </td>
                    <td className="num hide-mobile muted">{planned[c] ? money(planned[c], home) : '—'}</td>
                    <td className="num">{spent[c] ? money(spent[c], home) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{ marginTop: 12 }}>
            <Section
              open={linesOpen}
              onToggle={() => setLinesOpen((o) => !o)}
              title="Estimate breakdown"
              summary={lines.length ? `· ${plural(lines.length, 'line')} · change or remove any of them` : '· tap “Estimate for me” to fill this in'}
            >
              {lines.length === 0 && (
                <p className="small muted">
                  The estimate shows up here as lines such as “Accommodation · 3 nights × 1 room”. Edit an amount, remove a line you don't need (say, flights when you're already
                  at the start), or add your own.
                </p>
              )}
              {BUDGET_CATEGORIES.filter((c) => hasLines(c)).map((c) => (
                <div key={c} className="stack" style={{ gap: 4 }}>
                  <div className="row between">
                    <b className="small">
                      {BUDGET_LABELS[c].emoji} {BUDGET_LABELS[c].label}
                    </b>
                    <span className="small muted">{money(trip.budget[c] ?? 0, home)}</span>
                  </div>
                  {lines
                    .filter((l) => l.category === c)
                    .map((l) => (
                      <div key={l.id} className="row">
                        <input
                          className="grow"
                          defaultValue={l.label}
                          placeholder="What is it?"
                          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                          onBlur={(e) => e.target.value !== l.label && saveLines(lines.map((x) => (x.id === l.id ? { ...x, label: e.target.value } : x)))}
                        />
                        <input
                          type="number"
                          min={0}
                          style={{ width: 96, textAlign: 'right' }}
                          defaultValue={l.amount}
                          key={`${l.id}-${l.amount}`}
                          aria-label={`${l.label} amount`}
                          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                          onBlur={(e) => Number(e.target.value) !== l.amount && saveLines(lines.map((x) => (x.id === l.id ? { ...x, amount: Number(e.target.value) || 0 } : x)))}
                        />
                        <button className="icon-btn" aria-label={`Remove ${l.label}`} onClick={() => saveLines(lines.filter((x) => x.id !== l.id))}>
                          ✕
                        </button>
                      </div>
                    ))}
                </div>
              ))}
              <div className="row wrap">
                <select
                  defaultValue=""
                  aria-label="Add a line"
                  style={{ width: 'auto' }}
                  onChange={(e) => {
                    if (e.target.value) addLine(e.target.value as BudgetCategory)
                    e.target.value = ''
                  }}
                >
                  <option value="">＋ Add a line…</option>
                  {BUDGET_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {BUDGET_LABELS[c].emoji} {BUDGET_LABELS[c].label}
                    </option>
                  ))}
                </select>
              </div>
            </Section>
          </div>
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
