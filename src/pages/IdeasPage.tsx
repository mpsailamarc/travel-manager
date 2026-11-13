import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { applyBookings, applyPlan, applyTemplate, bookingPrompt, CHATBOTS, detailPrompt, mergeDetail, outlinePrompt, parseBookings, parseDetail, parsePlan, type AiOption } from '../lib/ai'
import { refreshChecklist } from '../lib/checklist'
import { BUDGET_LABELS } from '../lib/budget'
import { addDays, formatDate } from '../lib/dates'
import { money } from '../lib/format'
import { countryLabel } from '../lib/countries'
import { KIND_META } from '../components/kinds'
import { copyText, toast } from '../components/ui'
import { BUDGET_LEVELS, STYLES } from './TripFields'
import { useTripCtx } from './TripLayout'

type Tab = 'ideas' | 'bookings' | 'template'

export default function IdeasPage() {
  const [tab, setTab] = useState<Tab>('ideas')
  return (
    <div className="stack-lg">
      <div className="chips">
        <button className={`chip ${tab === 'ideas' ? 'on' : ''}`} onClick={() => setTab('ideas')}>
          ✨ Itinerary ideas
        </button>
        <button className={`chip ${tab === 'bookings' ? 'on' : ''}`} onClick={() => setTab('bookings')}>
          📧 Import booking emails
        </button>
        <button className={`chip ${tab === 'template' ? 'on' : ''}`} onClick={() => setTab('template')}>
          🧱 Quick template (no AI)
        </button>
      </div>
      {tab === 'ideas' && <ItineraryIdeas />}
      {tab === 'bookings' && <BookingImport />}
      {tab === 'template' && <Template />}
    </div>
  )
}

function Steps() {
  return (
    <div className="info-grid">
      <div className="info-tile">
        <div className="k">Step 1</div>
        <div className="v">Copy the prompt</div>
      </div>
      <div className="info-tile">
        <div className="k">Step 2</div>
        <div className="v">Paste it in a free chatbot</div>
      </div>
      <div className="info-tile">
        <div className="k">Step 3</div>
        <div className="v">Paste its answer back here</div>
      </div>
    </div>
  )
}

export function PromptBox({ prompt }: { prompt: string }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row wrap">
        <button className="btn-primary" onClick={() => copyText(prompt)}>
          📋 Copy the prompt
        </button>
        {CHATBOTS.map((c) => (
          <a key={c.name} className="btn" href={c.url} target="_blank" rel="noreferrer">
            Open {c.name} ↗
          </a>
        ))}
      </div>
      <details>
        <summary className="small muted">See the prompt</summary>
        <pre className="prompt">{prompt}</pre>
      </details>
    </div>
  )
}

function ItineraryIdeas() {
  const { trip, items, settings } = useTripCtx()
  const navigate = useNavigate()
  const storeKey = `tm-ideas:${trip.id}`
  const [answer, setAnswer] = useState(() => localStorage.getItem(storeKey) ?? '')
  const [replace, setReplace] = useState(true)
  const [chosen, setChosen] = useState<AiOption>()
  const prompt = outlinePrompt(trip, settings)

  const parsed = useMemo((): { options?: AiOption[]; truncated?: boolean; error?: string } => {
    if (!answer.trim()) return {}
    try {
      return parsePlan(answer)
    } catch (e) {
      return { error: (e as Error).message }
    }
  }, [answer])

  function onAnswer(text: string) {
    setAnswer(text)
    setChosen(undefined)
    localStorage.setItem(storeKey, text)
  }

  async function use(o: AiOption) {
    if (items.length && replace && !confirm(`Replace the ${items.length} items currently in your plan with "${o.title}"?`)) return
    await applyPlan(trip, o, settings.homeCurrency, replace)
    // Refresh rule-based checklist suggestions now that the itinerary exists.
    await refreshChecklist(trip.id, settings)
    toast(`"${o.title}" is now your plan`)
    navigate('../plan')
  }

  const replaceChoice = items.length > 0 && (
    <div className="row">
      <label className="inline small">
        <input type="radio" checked={replace} onChange={() => setReplace(true)} /> Replace my plan
      </label>
      <label className="inline small">
        <input type="radio" checked={!replace} onChange={() => setReplace(false)} /> Add to it
      </label>
    </div>
  )

  if (chosen) return <DetailStep option={chosen} onBack={() => setChosen(undefined)} onUse={use} replaceChoice={replaceChoice} />

  return (
    <div className="stack-lg">
      <div className="card stack">
        <div className="row between wrap">
          <h2>Get 3 itinerary options</h2>
          <span className="small muted">Free · uses any chatbot you like</span>
        </div>
        <div className="small">
          <b>Your brief:</b> {trip.countryCodes.map(countryLabel).join(', ') || 'open destination'}
          {trip.cities.length > 0 && ` (${trip.cities.join(', ')})`} · {formatDate(trip.startDate)} → {formatDate(trip.endDate)} · {trip.travellers.length} traveller(s)
          {trip.travellers.some((t) => t.type === 'child') && ` incl. kids aged ${trip.travellers.filter((t) => t.type === 'child').map((t) => t.age).join(', ')}`} ·{' '}
          {STYLES[trip.style].label} · {BUDGET_LEVELS[trip.budgetLevel].label}
          {trip.interests.length > 0 && ` · ${trip.interests.join(', ')}`}
          <span className="muted"> — change it with “Trip details” above.</span>
        </div>
        <Steps />
        <p className="small muted">You'll get 3 short outlines first; then the app asks for the full detail of the one you pick (free chatbots cut off very long replies).</p>
        <PromptBox prompt={prompt} />
        <label>
          Paste the chatbot's answer
          <textarea className="code" value={answer} onChange={(e) => onAnswer(e.target.value)} placeholder='```json&#10;{ "options": [ … ] }&#10;```' />
        </label>
        {parsed.error && <div className="notice error">{parsed.error}</div>}
        {parsed.truncated && (
          <div className="notice">The answer was cut off by the chatbot. Everything complete before the cut is shown below — the last option may be missing days.</div>
        )}
      </div>

      {parsed.options && (
        <>
          <div className="row wrap between">
            <h2>Pick an option</h2>
            {replaceChoice}
          </div>
          <div className="grid-3">
            {parsed.options.map((o, i) => (
              <OptionCard key={i} option={o} start={trip.startDate} currency={settings.homeCurrency} onUse={() => use(o)} onDetail={() => setChosen(o)} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function OptionCard({ option: o, start, currency, onUse, onDetail }: { option: AiOption; start: string; currency: string; onUse: () => void; onDetail: () => void }) {
  const total = Object.values(o.budget).reduce((s, v) => s + (v || 0), 0)
  const detailed = o.days.some((d) => d.items.length)
  return (
    <div className="card stack option-card">
      <div>
        <h3>{o.title}</h3>
        {o.route.length > 0 && <div className="small muted">{o.route.join(' → ')}</div>}
      </div>
      <p className="small">{o.summary}</p>
      <ul className="option-days" style={{ paddingLeft: 18, margin: 0 }}>
        {o.days.map((d) => (
          <li key={d.day}>
            <b>
              Day {d.day} · {formatDate(addDays(start, d.day - 1), { weekday: 'short', day: 'numeric' })}
            </b>{' '}
            {d.city && <span className="muted">{d.city}</span>}
            <div className="muted">{d.items.length ? d.items.map((it) => `${KIND_META[it.kind].emoji} ${it.title}`).join(' · ') : [d.title, ...d.highlights].filter(Boolean).join(' · ')}</div>
          </li>
        ))}
      </ul>
      {total > 0 && (
        <div className="small">
          <b>Budget ≈ {money(total, currency)}</b>
          <div className="muted tiny">
            {Object.entries(o.budget)
              .filter(([, v]) => v)
              .map(([k, v]) => `${BUDGET_LABELS[k as keyof typeof BUDGET_LABELS]?.label ?? k} ${money(v, currency)}`)
              .join(' · ')}
          </div>
        </div>
      )}
      {o.tips.length > 0 && (
        <details>
          <summary className="small">Tips ({o.tips.length})</summary>
          <ul className="small" style={{ paddingLeft: 18 }}>
            {o.tips.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </details>
      )}
      {detailed ? (
        <button className="btn-primary" onClick={onUse}>
          Use this plan
        </button>
      ) : (
        <div className="stack" style={{ gap: 6 }}>
          <button className="btn-primary" onClick={onDetail}>
            Get the detailed plan →
          </button>
          <button className="btn-sm btn-ghost" onClick={onUse}>
            Use the outline as it is
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Asks for the full plan of one option. If the chatbot's reply is cut off, the days already received are kept
 * and a follow-up prompt asks for the missing ones, in as many rounds as needed.
 */
function DetailStep({ option, onBack, onUse, replaceChoice }: { option: AiOption; onBack: () => void; onUse: (o: AiOption) => void; replaceChoice: ReactNode }) {
  const { trip, settings } = useTripCtx()
  const storeKey = `tm-detail:${trip.id}:${option.title}`
  const [replies, setReplies] = useState<string[]>(() => JSON.parse(localStorage.getItem(storeKey) ?? '[]'))
  const expected = option.days.map((d) => d.day)

  const setReply = (i: number, text: string) => {
    const next = [...replies]
    next[i] = text
    // Editing an earlier reply invalidates the follow-ups built from it.
    const trimmed = next.slice(0, i + 1)
    setReplies(trimmed)
    localStorage.setItem(storeKey, JSON.stringify(trimmed))
  }

  // Walk through the replies in order, tracking which days are still missing before each one.
  const rounds: { prompt: string; text: string; result?: ReturnType<typeof parseDetail>; error?: string; missingBefore: number[] }[] = []
  const ok: ReturnType<typeof parseDetail>[] = []
  let missing = expected
  for (let i = 0; i <= replies.length; i++) {
    if (i > 0 && (!rounds[i - 1].result || !missing.length)) break
    const prompt = detailPrompt(trip, settings, option, missing, i > 0)
    const text = replies[i] ?? ''
    const round: (typeof rounds)[number] = { prompt, text, missingBefore: missing }
    if (text.trim()) {
      try {
        round.result = parseDetail(text)
        ok.push(round.result)
        const done = new Set(ok.flatMap((r) => r.days.filter((d) => d.items.length).map((d) => d.day)))
        missing = expected.filter((n) => !done.has(n))
      } catch (e) {
        round.error = (e as Error).message
      }
    }
    rounds.push(round)
  }
  const merged = mergeDetail(option, ok)
  const detailedCount = expected.length - missing.length

  return (
    <div className="stack-lg" style={{ maxWidth: 900 }}>
      <div className="row wrap between">
        <button className="btn-ghost" onClick={onBack}>
          ← Back to the options
        </button>
        {replaceChoice}
      </div>
      <div className="card stack">
        <h2>Detailed plan: {option.title}</h2>
        <p className="small muted">{option.route.join(' → ')} · {expected.length} days</p>
        {rounds.map((r, i) => (
          <div key={i} className="stack" style={{ gap: 8 }}>
            {i === 0 ? (
              <p className="small">
                <b>1 ·</b> Copy this prompt into the chatbot (the same chat is fine), then paste its answer below.
              </p>
            ) : (
              <div className="notice info">
                {i === 1 ? 'The answer stopped early' : 'Still some days missing'}: days {r.missingBefore.join(', ')} have no detail yet. Copy this follow-up prompt into the{' '}
                <b>same chat</b> and paste the answer below.
              </div>
            )}
            <PromptBox prompt={r.prompt} />
            <label>
              {i === 0 ? "Paste the chatbot's answer" : `Answer ${i + 1}`}
              <textarea className="code" value={r.text} onChange={(e) => setReply(i, e.target.value)} placeholder='{"days": [ … ]}' />
            </label>
            {r.error && <div className="notice error">{r.error}</div>}
            {r.result && (
              <p className="small muted">
                ✓ Got {r.result.days.filter((d) => d.items.length).length} day(s)
                {r.result.truncated && ' — the answer was cut off, so the last unfinished day was left out'}.
              </p>
            )}
          </div>
        ))}
      </div>

      {detailedCount > 0 && (
        <div className="card stack">
          <div className="row between wrap">
            <h3>
              {detailedCount} of {expected.length} days detailed
            </h3>
            <button className="btn-primary" onClick={() => onUse(merged)}>
              Use this plan
            </button>
          </div>
          {missing.length > 0 && <p className="small muted">Days without detail ({missing.join(', ')}) will use the outline's highlights as ideas — you can still fill them in later.</p>}
          <ul className="option-days" style={{ paddingLeft: 18, margin: 0, maxHeight: 360 }}>
            {merged.days.map((d) => (
              <li key={d.day}>
                <b>
                  Day {d.day} · {formatDate(addDays(trip.startDate, d.day - 1), { weekday: 'short', day: 'numeric' })}
                </b>{' '}
                <span className="muted">{d.city}</span>
                <div className="muted">
                  {d.items.length ? d.items.map((it) => `${it.time ? it.time + ' ' : ''}${KIND_META[it.kind].emoji} ${it.title}`).join(' · ') : `(outline) ${d.highlights.join(' · ')}`}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function BookingImport() {
  const { trip, settings } = useTripCtx()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [answer, setAnswer] = useState('')

  const parsed = useMemo(() => {
    if (!answer.trim()) return {}
    try {
      return { items: parseBookings(answer) }
    } catch (e) {
      return { error: (e as Error).message }
    }
  }, [answer])

  async function add() {
    if (!parsed.items) return
    await applyBookings(trip, parsed.items, settings.homeCurrency)
    toast(`Added ${parsed.items.length} booking(s) to the plan`)
    navigate('../plan')
  }

  return (
    <div className="card stack" style={{ maxWidth: 820 }}>
      <h2>Turn confirmation emails into plan items</h2>
      <p className="small muted">
        Paste the text of flight, train, hotel or ticket confirmations. Remove anything you don't want to send to the chatbot (e.g. card details, passport numbers) — only
        dates, times, places and booking references are needed.
      </p>
      <label>
        1 · Confirmation text
        <textarea value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Paste one or more confirmation emails…" />
      </label>
      {email.trim() && <PromptBox prompt={bookingPrompt(trip, settings, email)} />}
      <label>
        2 · Paste the chatbot's answer
        <textarea className="code" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder='{"items": [ … ]}' />
      </label>
      {parsed.error && <div className="notice error">{parsed.error}</div>}
      {parsed.items && (
        <div className="stack" style={{ gap: 6 }}>
          {parsed.items.map((it, i) => (
            <div key={i} className="row small">
              <span>{KIND_META[it.kind].emoji}</span>
              <b>{it.date}</b>
              <span>{it.time}</span>
              <span className="grow">{it.title}</span>
              {it.bookingRef && <span className="badge">{it.bookingRef}</span>}
            </div>
          ))}
          {parsed.items.some((it) => it.date < trip.startDate || it.date > trip.endDate) && (
            <div className="notice">Some bookings fall outside the trip dates — they'll appear at the bottom of the Plan until you adjust the dates.</div>
          )}
          <div>
            <button className="btn-primary" onClick={add}>
              Add {parsed.items.length} booking(s) as “Booked”
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Template() {
  const { trip, items } = useTripCtx()
  const navigate = useNavigate()
  async function go() {
    if (items.length && !confirm('Add template items to your existing plan?')) return
    await applyTemplate(trip)
    toast('Skeleton plan created')
    navigate('../plan')
  }
  return (
    <div className="card stack" style={{ maxWidth: 720 }}>
      <h2>Start from a simple skeleton</h2>
      <p className="small">
        Spreads your days evenly across {trip.cities.length ? trip.cities.join(', ') : 'your destinations'}, with travel between places and one accommodation per stop.
        Everything is marked as an <i>idea</i> so you can fill in the details yourself. Works completely offline.
      </p>
      {!trip.cities.length && <div className="notice info">Tip: add the cities you want to visit (in order) in “Trip details” first.</div>}
      <div>
        <button className="btn-primary" onClick={go}>
          Create the skeleton
        </button>
      </div>
    </div>
  )
}
