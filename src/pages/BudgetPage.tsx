import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, touchTrip } from '../db'
import type { BudgetCategory, BudgetLine, Expense, ItemKind } from '../types'
import { BUDGET_CATEGORIES } from '../types'
import { BUDGET_LABELS, budgetFromLines, estimateBudgetLines, inferAssumption, lineAmount, perPhrase, unitFor } from '../lib/budget'
import { fxRate } from '../lib/apis'
import { country } from '../lib/countries'
import { daysBetween, formatDate, today } from '../lib/dates'
import { money, plural } from '../lib/format'
import { useAsync, useMediaQuery } from '../lib/hooks'
import { Progress, toast } from '../components/ui'
import { uid } from '../lib/ids'
import { QuickExpense } from '../components/QuickExpense'
import { ExpenseEditor } from '../components/ExpenseEditor'
import { useTripCtx } from './TripLayout'

const KIND_TO_CATEGORY: Record<ItemKind, BudgetCategory> = {
  flight: 'flights',
  train: 'transport',
  bus: 'transport',
  car: 'transport',
  drive: 'transport',
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
  const cols = useMediaQuery('(min-width: 721px)') ? 4 : 3 // the 'In plan' column is hidden on phones
  const [basisOpen, setBasisOpen] = useState(false)
  const [folded, setFolded] = useState<Partial<Record<BudgetCategory, boolean>>>({})
  const [assumptions, setAssumptions] = useState<Set<string>>(new Set()) // lines whose quantity × price editor is open
  // Lines from an older estimate get their quantity and price read back from their label (the amount stays the same).
  useEffect(() => {
    const old = trip.budgetLines
    if (!old) return
    const next = old.map((l) => (l.qty && l.price ? l : inferAssumption(l)))
    // Amounts don't change here, so the category totals stay as they are.
    if (next.some((l, i) => l !== old[i])) db.trips.update(trip.id, { budgetLines: next })
  }, [trip.id, trip.budgetLines])

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
    if (
      (totalBudget || lines.length) &&
      !confirm(
        'Estimate for me builds a rough starting budget from typical costs for your destination, your budget level and your group.\n\n' +
          'It REPLACES the budget numbers and lines you have now (your expenses and plan costs are not touched).\n\nContinue?',
      )
    )
      return
    const { lines: next, basis } = await estimateBudgetLines(trip, settings.nationality, home, items)
    // A fresh estimate replaces everything: categories it has no lines for (e.g. flights) are cleared.
    await db.trips.update(trip.id, { budgetLines: next, budgetBasis: basis, planBudget: undefined, budget: budgetFromLines(next, {}, []) })
    await touchTrip(trip.id)
    setBasisOpen(true)
    toast('Estimate filled in — see “How this was estimated” below the table')
  }

  /** Adding the first line to a category that had a typed-in budget keeps that amount as a line, so nothing is lost. */
  async function addLine(c: BudgetCategory) {
    const keep = !hasLines(c) && trip.budget[c] ? [{ id: uid(), category: c, label: 'Your earlier budget', amount: trip.budget[c]! }] : []
    const line: BudgetLine = { id: uid(), category: c, label: '', amount: 0, qty: 1 }
    await saveLines([...lines, ...keep, line])
    setFolded((f) => ({ ...f, [c]: false }))
    setAssumptions((a) => new Set(a).add(line.id)) // a new line opens its quantity × price editor
  }

  /** Change a line's assumption; the amount follows (quantity × price) once both are filled in. */
  async function setAssumption(l: BudgetLine, patch: Partial<Pick<BudgetLine, 'qty' | 'unit' | 'price'>>) {
    const next = { ...l, ...patch }
    next.amount = lineAmount(next)
    await saveLines(lines.map((x) => (x.id === l.id ? next : x)))
  }

  async function setBudget(c: BudgetCategory, v: number) {
    // A figure you type is yours: switching itinerary idea won't remove it.
    await db.trips.update(trip.id, { budget: { ...trip.budget, [c]: v || undefined }, planBudget: trip.planBudget?.filter((x) => x !== c) })
  }

  const byDate = [...expenses].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)

  return (
    <div className="stack-lg">
      <div className="info-grid">
        <Kpi k="Budget" v={money(totalBudget, home)} />
        <Kpi
          k="In the plan"
          v={money(totalPlanned, home)}
          sub={
            totalBudget > 0
              ? totalPlanned > totalBudget
                ? `${money(totalPlanned - totalBudget, home)} over the budget`
                : `${money(totalBudget - totalPlanned, home)} of the budget isn't in the plan yet`
              : 'prices on itinerary items'
          }
          warn={totalPlanned > totalBudget && totalBudget > 0}
        />
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
            <div className="row">
              {lines.length > 0 && (
                <button className="btn-sm btn-ghost" onClick={() => setFolded(BUDGET_CATEGORIES.every((c) => !hasLines(c) || folded[c]) ? {} : Object.fromEntries(BUDGET_CATEGORIES.map((c) => [c, true])))}>
                  {BUDGET_CATEGORIES.every((c) => !hasLines(c) || folded[c]) ? 'Expand all' : 'Collapse all'}
                </button>
              )}
              <button className="btn-sm" onClick={estimate}>
                🧮 Estimate for me
              </button>
            </div>
          </div>
          <p className="small muted" style={{ marginBottom: 8 }}>
            Not sure what to put? <b>🧮 Estimate for me</b> fills in a rough budget from typical costs for your destination, your budget level and your group. Every line shows
            <i> quantity × price</i> (for example <i>3 nights × A$263 per night</i>) so you can change it, remove it, or add your own with ＋.
          </p>
          <datalist id="budget-units">
            {['days', 'nights', 'km', 'person-days', 'travellers', 'trips', 'tickets', 'meals'].map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
          <table className="budget-table">
            <thead>
              <tr>
                <th>Category</th>
                <th className="num">Budget ({home})</th>
                <th className="num hide-mobile">In plan</th>
                <th className="num" title="Bookings paid ahead + expenses">Spent</th>
              </tr>
            </thead>
            <tbody>
              {BUDGET_CATEGORIES.flatMap((c) => {
                const b = trip.budget[c] ?? 0
                const catLines = lines.filter((l) => l.category === c)
                const isFolded = !!folded[c]
                const main = (
                  <tr key={c}>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        {catLines.length > 0 ? (
                          <button className="icon-btn" aria-expanded={!isFolded} aria-label={`${isFolded ? 'Expand' : 'Collapse'} ${BUDGET_LABELS[c].label}`} onClick={() => setFolded((f) => ({ ...f, [c]: !isFolded }))}>
                            {isFolded ? '▸' : '▾'}
                          </button>
                        ) : (
                          <span style={{ width: 26 }} />
                        )}
                        <span className="grow">
                          {BUDGET_LABELS[c].emoji} {BUDGET_LABELS[c].label}
                          {isFolded && <span className="tiny muted"> · {plural(catLines.length, 'line')}</span>}
                        </span>
                        <button className="icon-btn" aria-label={`Add a line to ${BUDGET_LABELS[c].label}`} title="Add a line" onClick={() => addLine(c)}>
                          ＋
                        </button>
                      </div>
                      {b > 0 && (
                        <div style={{ marginTop: 4 }}>
                          <Progress value={Math.max(spent[c], 0)} max={b} over={spent[c] > b} />
                        </div>
                      )}
                      {(b > 0 || planned[c] > 0) && (
                        <div className="tiny muted" style={{ marginTop: 3, color: planned[c] > b && b > 0 ? 'var(--danger)' : undefined }}>
                          {planned[c] > 0 ? `In plan ${money(planned[c], home)}` : 'Nothing priced in the plan'}
                          {b > 0 && planned[c] < b && ` · ${money(b - planned[c], home)} not planned yet`}
                          {b > 0 && planned[c] > b && ` · ${money(planned[c] - b, home)} over budget`}
                        </div>
                      )}
                    </td>
                    <td className="num">
                      {catLines.length ? (
                        <b title="Adds up the lines underneath">{money(b, home)}</b>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          style={{ width: '100%', minWidth: 0, textAlign: 'right' }}
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
                // The breakdown sits right under its category. Each line: a name, an amount — or a quantity × price assumption.
                const sub = isFolded
                  ? []
                  : catLines.flatMap((l) => {
                      const calc = !!(l.qty && l.price)
                      const open = assumptions.has(l.id)
                      const toggle = () => {
                        // Opening the editor on a line without an assumption starts it as "1 × its amount", never empty.
                        if (!open && !(l.qty && l.price)) saveLines(lines.map((x) => (x.id === l.id ? inferAssumption(x, true) : x)))
                        setAssumptions((a) => {
                          const n = new Set(a)
                          if (n.has(l.id)) n.delete(l.id)
                          else n.add(l.id)
                          return n
                        })
                      }
                      const rows = [
                        // The name gets the full width on its own row: long names stay readable on a phone.
                        <tr key={l.id + '-name'} className="budget-line budget-line-name">
                          <td colSpan={cols} style={{ paddingLeft: 14 }}>
                            <textarea
                              rows={l.label.length > 34 ? 2 : 1}
                              style={{ minHeight: 0, resize: 'none', fontSize: '0.9rem', lineHeight: 1.3, padding: '6px 8px' }}
                              defaultValue={l.label}
                              placeholder="What is it?"
                              aria-label="Line name"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  e.currentTarget.blur()
                                }
                              }}
                              onBlur={(e) => e.target.value !== l.label && saveLines(lines.map((x) => (x.id === l.id ? { ...x, label: e.target.value } : x)))}
                            />
                          </td>
                        </tr>,
                        <tr key={l.id} className="budget-line">
                          <td style={{ paddingLeft: 14 }}>
                            <button className="btn-ghost btn-sm" style={{ minHeight: 24, padding: '0 4px', color: 'var(--primary)', textAlign: 'left' }} onClick={toggle} aria-expanded={open}>
                              {calc ? `${l.qty} ${unitFor(l.qty!, l.unit)} × ${money(l.price!, home, l.price! < 10 ? 2 : 0)} ${perPhrase(l.unit)}` : '＋ assumption'} {open ? '▴' : '▾'}
                            </button>
                          </td>
                          <td className="num">
                            {calc ? (
                              <span title="Quantity × price">{money(lineAmount(l), home)}</span>
                            ) : (
                              <input
                                type="number"
                                min={0}
                                style={{ width: '100%', minWidth: 0, textAlign: 'right' }}
                                defaultValue={l.amount}
                                key={`${l.id}-${l.amount}`}
                                aria-label={`${l.label} amount`}
                                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                                onBlur={(e) => Number(e.target.value) !== l.amount && saveLines(lines.map((x) => (x.id === l.id ? { ...x, amount: Number(e.target.value) || 0 } : x)))}
                              />
                            )}
                          </td>
                          <td className="hide-mobile" />
                          <td className="num">
                            <button className="icon-btn" aria-label={`Remove ${l.label}`} onClick={() => saveLines(lines.filter((x) => x.id !== l.id))}>
                              ✕
                            </button>
                          </td>
                        </tr>,
                      ]
                      if (open)
                        rows.push(
                          <tr key={l.id + '-assumption'} className="budget-line">
                            <td colSpan={cols} style={{ paddingLeft: 14 }}>
                              <div className="row wrap" style={{ gap: 6 }}>
                                <input
                                  type="number"
                                  min={0}
                                  step="any"
                                  style={{ width: 84 }}
                                  placeholder="Qty"
                                  aria-label="Quantity"
                                  defaultValue={l.qty ?? ''}
                                  key={`${l.id}-q-${l.qty}`}
                                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                                  onBlur={(e) => Number(e.target.value) !== (l.qty ?? 0) && setAssumption(l, { qty: Number(e.target.value) || undefined })}
                                />
                                <input
                                  list="budget-units"
                                  style={{ width: 104 }}
                                  placeholder="unit (days, km…)"
                                  aria-label="Unit"
                                  defaultValue={l.unit ?? ''}
                                  key={`${l.id}-u-${l.unit}`}
                                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                                  onBlur={(e) => e.target.value !== (l.unit ?? '') && setAssumption(l, { unit: e.target.value || undefined })}
                                />
                                <span className="muted">×</span>
                                <input
                                  type="number"
                                  min={0}
                                  step="any"
                                  style={{ width: 92 }}
                                  placeholder={`Price per ${unitFor(1, l.unit) || 'unit'} (${home})`}
                                  aria-label="Price per unit"
                                  defaultValue={l.price ?? ''}
                                  key={`${l.id}-p-${l.price}`}
                                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                                  onBlur={(e) => Number(e.target.value) !== (l.price ?? 0) && setAssumption(l, { price: Number(e.target.value) || undefined })}
                                />
                                <b className="small">= {money(lineAmount(l), home)}</b>
                              </div>
                              <span className="tiny muted">e.g. 4 days × {money(60, home)} a day, or 600 km × {money(0.2, home, 2)} a km. Leave it empty to type the amount directly.</span>
                            </td>
                          </tr>,
                        )
                      return rows
                    })
                return [main, ...sub]
              })}
            </tbody>
          </table>
          {trip.budgetBasis && lines.length > 0 && (
            <details className="card tight" style={{ marginTop: 10 }} open={basisOpen} onToggle={(e) => setBasisOpen(e.currentTarget.open)}>
              <summary className="small strong" style={{ cursor: 'pointer' }}>
                ℹ️ How this was estimated
              </summary>
              <ul className="small" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {trip.budgetBasis.map((b, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    {b}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <details className="card tight" style={{ marginTop: 10 }}>
            <summary className="small strong" style={{ cursor: 'pointer' }}>
              ❓ Why is there a gap between Budget and In the plan?
            </summary>
            <ul className="small" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              <li style={{ marginBottom: 4 }}>
                <b>Budget</b> is what you expect the whole trip to cost: your estimate or the figures you typed.
              </li>
              <li style={{ marginBottom: 4 }}>
                <b>In the plan</b> only adds up itinerary items that have a <b>price</b> (a flight or a hotel with a cost). Meals, local transport and activities you
                haven't priced aren't counted, so most of the gap is spending that's in the budget but not in the plan yet.
              </li>
              <li style={{ marginBottom: 4 }}>
                A category in red means the prices in the plan add up to <b>more</b> than its budget: raise the budget or lower a price.
              </li>
              <li>To shrink the gap, open an item in the plan → Edit details → Cost. Items you skip aren't counted.</li>
            </ul>
          </details>
          <p className="tiny muted" style={{ marginTop: 8 }}>
            <b>Spent</b> = bookings that have a booking reference (paid ahead) + expenses you log.
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
