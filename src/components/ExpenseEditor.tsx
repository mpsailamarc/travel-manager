import { useState } from 'react'
import { db } from '../db'
import type { BudgetCategory, Expense } from '../types'
import { BUDGET_CATEGORIES } from '../types'
import { BUDGET_LABELS } from '../lib/budget'
import { CURRENCIES } from '../lib/countries'
import { fxRate } from '../lib/apis'
import { money } from '../lib/format'
import { Modal, toast } from './ui'

/** Edit a logged expense: amount, currency, date, category, note — and what it came to in your home currency. */
export function ExpenseEditor({ expense, home, onClose }: { expense: Expense; home: string; onClose: () => void }) {
  const [amount, setAmount] = useState(String(expense.amount))
  const [currency, setCurrency] = useState(expense.currency)
  const [date, setDate] = useState(expense.date)
  const [category, setCategory] = useState<BudgetCategory>(expense.category)
  const [note, setNote] = useState(expense.note ?? '')
  const [homeAmount, setHomeAmount] = useState(String(Math.round(expense.amountHome * 100) / 100))
  const [busy, setBusy] = useState(false)

  const value = Number(amount.replace(',', '.'))
  const homeValue = Number(homeAmount.replace(',', '.'))

  /** Keep the home-currency amount in step with the amount: same currency keeps the rate used when it was logged. */
  async function recalc(nextAmount: string, nextCurrency: string) {
    const v = Number(nextAmount.replace(',', '.'))
    if (!v) return
    if (nextCurrency === home) return setHomeAmount(String(v))
    if (nextCurrency === expense.currency && expense.amount) return setHomeAmount(String(Math.round(((v * expense.amountHome) / expense.amount) * 100) / 100))
    const rate = await fxRate(nextCurrency, home)
    if (rate) setHomeAmount(String(Math.round(v * rate * 100) / 100))
  }

  async function save() {
    if (!(value > 0)) return toast('Enter an amount')
    setBusy(true)
    await db.expenses.update(expense.id, {
      amount: value,
      currency,
      date,
      category,
      note: note.trim() || undefined,
      amountHome: homeValue > 0 ? homeValue : value,
    })
    toast('Expense updated')
    onClose()
  }

  async function remove() {
    if (!confirm(`Delete this expense (${money(expense.amount, expense.currency, 2)})?`)) return
    await db.expenses.delete(expense.id)
    onClose()
  }

  return (
    <Modal title="Edit expense" onClose={onClose}>
      <div className="stack">
        <div className="form-grid">
          <label>
            Amount
            <input
              inputMode="decimal"
              autoFocus
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value)
                recalc(e.target.value, currency)
              }}
            />
          </label>
          <label>
            Currency
            <select
              value={currency}
              onChange={(e) => {
                setCurrency(e.target.value)
                recalc(amount, e.target.value)
              }}
            >
              {[...new Set([currency, ...CURRENCIES])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          {currency !== home && (
            <label>
              In {home}
              <input inputMode="decimal" value={homeAmount} onChange={(e) => setHomeAmount(e.target.value)} />
            </label>
          )}
          <label>
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        <div className="chips">
          {BUDGET_CATEGORIES.map((c) => (
            <button key={c} type="button" className={`chip ${category === c ? 'on' : ''}`} onClick={() => setCategory(c)}>
              {BUDGET_LABELS[c].emoji} {BUDGET_LABELS[c].label}
            </button>
          ))}
        </div>
        <label>
          Note
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was it for?" />
        </label>
        {currency !== home && <p className="tiny muted">The {home} amount follows the amount you type; change it by hand if your card charged something different.</p>}
        <div className="row between">
          <button type="button" className="btn-ghost btn-danger" onClick={remove}>
            Delete
          </button>
          <div className="row">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn-primary" disabled={busy} onClick={save}>
              Save
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
