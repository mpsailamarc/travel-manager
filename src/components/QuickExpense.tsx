import { useState } from 'react'
import { Link } from 'react-router-dom'
import { db } from '../db'
import type { BudgetCategory } from '../types'
import { BUDGET_CATEGORIES } from '../types'
import { CURRENCIES } from '../lib/countries'
import { fxRate } from '../lib/apis'
import { BUDGET_LABELS } from '../lib/budget'
import { money } from '../lib/format'
import { uid } from '../lib/ids'
import { toast } from './ui'

export function QuickExpense({ tripId, date, home, local, budgetLink = true }: { tripId: string; date: string; home: string; local: string; budgetLink?: boolean }) {
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(local)
  const [category, setCategory] = useState<BudgetCategory>('food')
  const [note, setNote] = useState('')

  async function add() {
    const value = Number(amount.replace(',', '.'))
    if (!value) return
    const rate = await fxRate(currency, home)
    if (rate == null) toast(`No ${currency}→${home} rate available offline; saved without conversion`)
    await db.expenses.add({
      id: uid(),
      tripId,
      date,
      amount: value,
      currency,
      amountHome: value * (rate ?? 1),
      category,
      note: note || undefined,
      createdAt: Date.now(),
    })
    setAmount('')
    setNote('')
    toast(`Logged ${money(value, currency, 2)}`)
  }

  return (
    <div className="card stack" style={{ gap: 8 }}>
      <div className="row between">
        <h3>💳 Log a spend</h3>
        {budgetLink && (
          <Link to="../budget" className="small">
            Budget →
          </Link>
        )}
      </div>
      <div className="row">
        <input inputMode="decimal" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <select style={{ width: 90 }} value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <div className="chips">
        {BUDGET_CATEGORIES.filter((c) => c !== 'flights').map((c) => (
          <button key={c} className={`chip ${category === c ? 'on' : ''}`} onClick={() => setCategory(c)}>
            {BUDGET_LABELS[c].emoji} {BUDGET_LABELS[c].label}
          </button>
        ))}
      </div>
      <div className="row">
        <input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn-primary" onClick={add} disabled={!amount}>
          Add
        </button>
      </div>
    </div>
  )
}
