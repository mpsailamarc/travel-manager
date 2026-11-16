import { useState } from 'react'
import { db } from '../db'
import type { BudgetCategory } from '../types'
import { BUDGET_CATEGORIES } from '../types'
import { CURRENCIES } from '../lib/countries'
import { fxRate } from '../lib/apis'
import { BUDGET_LABELS } from '../lib/budget'
import { money } from '../lib/format'
import { uid } from '../lib/ids'
import { today } from '../lib/dates'
import { toast } from './ui'
import { t } from '../i18n'

export function QuickExpense({ tripId, home, local }: { tripId: string; home: string; local: string }) {
  const [amount, setAmount] = useState('')
  // Defaults to today's date on this device (not the trip's dates): you log what you just spent.
  const [date, setDate] = useState(today)
  const [currency, setCurrency] = useState(local)
  const [category, setCategory] = useState<BudgetCategory>('food')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function add() {
    const value = Number(amount.replace(',', '.'))
    if (!value || busy) return
    setBusy(true) // the exchange-rate lookup can take a moment: a second tap must not log it twice
    const rate = await fxRate(currency, home)
    if (rate == null) toast(t('No {from}→{to} rate available offline; saved without conversion', { from: currency, to: home }))
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
    setBusy(false)
    toast(t('Logged {amount}', { amount: money(value, currency, 2) }))
  }

  return (
    <div className="card stack" style={{ gap: 8 }}>
      <h3>{t('💳 Log a spend')}</h3>
      <div className="row">
        <input inputMode="decimal" placeholder={t('Amount')} value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
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
        <input type="date" value={date} onChange={(e) => setDate(e.target.value || today())} style={{ maxWidth: 160 }} aria-label={t('Date')} />
        <input placeholder={t('Note (optional)')} value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn-primary" onClick={add} disabled={!amount || busy}>
          {t('Add')}
        </button>
      </div>
    </div>
  )
}
