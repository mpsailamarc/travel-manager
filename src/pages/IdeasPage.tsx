import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { applyBookings, applyPlan, applyTemplate, bookingPrompt, CHATBOTS, detailPrompt, mergeDetail, outlinePrompt, outlineRounds, parseBookings, parseDetail, parseRevision, revisePrompt, routeShape, type AiOption } from '../lib/ai'
import { OptionMap } from '../components/OptionMap'
import { refreshChecklist } from '../lib/checklist'
import { BUDGET_LABELS } from '../lib/budget'
import { addDays, daysBetween, formatDate } from '../lib/dates'
import { money, plural } from '../lib/format'
import { countryLabel } from '../lib/countries'
import { KIND_META } from '../components/kinds'
import { copyText, toast } from '../components/ui'
import { aiReady, askAI, getAiConfig, useAiConfig } from '../lib/openai'
import { askAllCityIdeas } from '../lib/cityideas'
import { fillUntimedTrip } from '../lib/favorites'
import { BUDGET_LEVELS, STYLES } from './TripFields'
import { useTripCtx } from './TripLayout'
import { saveLocal } from '../lib/storage'
import type { Trip } from '../types'

type Tab = 'ideas' | 'bookings' | 'template'

export default function IdeasPage() {
  // A link can open a part directly: "Import a booking email" from Where you sleep or Docs.
  const [params] = useSearchParams()
  const [tab, setTab] = useState<Tab>(() => (['ideas', 'bookings', 'template'].includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'ideas'))
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
  const api = aiReady(useAiConfig())
  const steps = api ? ['Press “Ask ChatGPT”', 'It fills in the answer for you', 'Check it and use it'] : ['Copy the prompt', 'Paste it in a free chatbot', 'Paste its answer back here']
  return (
    <div className="info-grid">
      {steps.map((v, i) => (
        <div key={i} className="info-tile">
          <div className="k">Step {i + 1}</div>
          <div className="v">{v}</div>
        </div>
      ))}
    </div>
  )
}

export function PromptBox({
  prompt,
  history,
  onAnswer,
  autoAsk,
}: {
  prompt: string
  history?: { prompt: string; reply: string }[]
  onAnswer?: (text: string) => void
  autoAsk?: boolean // ask ChatGPT at once (when it's set up), e.g. for new ideas after the trip changed
}) {
  const cfg = useAiConfig()
  const [busy, setBusy] = useState(false)
  const [chars, setChars] = useState(0)
  const [error, setError] = useState<string>()
  const api = aiReady(cfg) && !!onAnswer
  const asked = useRef(false)
  useEffect(() => {
    if (autoAsk && api && !asked.current) {
      asked.current = true
      void ask()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAsk, api])

  async function ask() {
    setBusy(true)
    setChars(0)
    setError(undefined)
    try {
      // Follow-up prompts ("same chat") need the earlier questions and answers, as a chat window would keep them.
      const messages = [...(history ?? []).flatMap((h) => [{ role: 'user' as const, content: h.prompt }, { role: 'assistant' as const, content: h.reply }]), { role: 'user' as const, content: prompt }]
      onAnswer!(await askAI(messages, setChars))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const copyRow = (
    <div className="row wrap">
      <button className={api ? '' : 'btn-primary'} onClick={() => copyText(prompt)}>
        📋 Copy the prompt
      </button>
      {CHATBOTS.map((c) => (
        <a key={c.name} className="btn" href={c.url} target="_blank" rel="noreferrer">
          Open {c.name} ↗
        </a>
      ))}
    </div>
  )

  if (api)
    return (
      <div className="stack" style={{ gap: 8 }}>
        <div className="row wrap">
          <button className="btn-primary" disabled={busy} onClick={ask}>
            {busy ? (chars ? `⏳ ChatGPT is writing… ${chars.toLocaleString()} characters` : '⏳ ChatGPT is thinking…') : '✨ Ask ChatGPT'}
          </button>
          <span className="tiny muted">uses your API key · {cfg.model}</span>
        </div>
        {error && <div className="notice error">{error}</div>}
        <details>
          <summary className="small muted">What is sent</summary>
          <pre className="prompt">{prompt}</pre>
        </details>
      </div>
    )
  return (
    <div className="stack" style={{ gap: 8 }}>
      {copyRow}
      <details>
        <summary className="small muted">See the prompt</summary>
        <pre className="prompt">{prompt}</pre>
      </details>
    </div>
  )
}

/**
 * Where the chatbot's answer goes. With copy and paste it's the box you paste into. With ChatGPT set up the answer is
 * filled in for you, so the box stays folded away ("Show the answer") and only appears once there is one.
 */
export function AnswerBox({ label, value, onChange, placeholder, minHeight }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; minHeight?: number }) {
  const api = aiReady(useAiConfig())
  const box = <textarea className="code" style={minHeight ? { minHeight } : undefined} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
  if (!api)
    return (
      <label>
        {label}
        {box}
      </label>
    )
  if (!value.trim()) return null
  return (
    <details>
      <summary className="small muted">Show ChatGPT's answer (you can edit it)</summary>
      {box}
    </details>
  )
}

/** The wording of a step: "copy this into the chatbot…" with copy and paste, "Ask ChatGPT…" with a key. */
export function useAiWords() {
  return aiReady(useAiConfig())
}

/** Keeps the pasted answers on this device; if even that doesn't fit, they still work until you leave the page. */
function keep(key: string, replies: unknown[]) {
  if (!saveLocal(key, JSON.stringify(replies))) toast("This device's storage is full: the answer works now but won't be kept if you leave the page")
}

function ItineraryIdeas() {
  const api = useAiWords()
  const { trip, items, settings } = useTripCtx()
  const navigate = useNavigate()
  const storeKey = `tm-ideas2:${trip.id}`
  const [replies, setReplies] = useState<string[]>(() => {
    const saved = localStorage.getItem(storeKey)
    if (saved) return JSON.parse(saved)
    const legacy = localStorage.getItem(`tm-ideas:${trip.id}`) // single answer from the earlier version
    return legacy ? [legacy] : []
  })
  const [replace, setReplace] = useState(true)
  // Revisions: another go at an option with changes (nights per place, a place added…), as many times as it takes. Each is one more
  // option to look at (with its map); the detailed plan comes after, once you're happy.
  const revKey = `tm-revisions:${trip.id}`
  const [revisions, setRevisions] = useState<{ from: number; changes: string; reply: string }[]>(() => JSON.parse(localStorage.getItem(revKey) ?? '[]'))
  const [pending, setPending] = useState<{ from: number; changes: string }>()
  const [pick, setPick] = useState(0)
  const saveRevisions = (next: typeof revisions) => {
    setRevisions(next)
    keep(revKey, next)
  }
  const [chosen, setChosen] = useState<AiOption>()
  const tripDays = daysBetween(trip.startDate, trip.endDate) + 1
  const { rounds, options, compare, done } = useMemo(() => outlineRounds(replies, outlinePrompt(trip, settings), tripDays), [replies, trip, settings, tripDays])
  // The options you were given, then each revision (its reply read; one that can't be read is left out).
  const all = useMemo(() => {
    const out: { option: AiOption; incomplete?: boolean; revised?: { from: number; changes: string } }[] = options.map((o) => ({ ...o }))
    for (const r of revisions) {
      try {
        out.push({ option: parseRevision(r.reply), revised: { from: r.from, changes: r.changes } })
      } catch {
        /* skipped */
      }
    }
    return out
  }, [options, revisions])

  function setReply(i: number, text: string) {
    // Editing an earlier reply invalidates the follow-ups that were built from it.
    const next = [...replies.slice(0, i), text]
    setReplies(next)
    setChosen(undefined)
    saveRevisions([])
    setPending(undefined)
    keep(storeKey, next)
  }

  function startOver() {
    if (!confirm('Clear the pasted answers and start again?')) return
    setReplies([])
    localStorage.removeItem(storeKey)
    saveRevisions([])
    setPending(undefined)
  }

  // Coming from "New itinerary ideas" (the trip changed): the old answers were for the old trip, so they go; with ChatGPT
  // set up, the first option is asked for straight away.
  const [params, setParams] = useSearchParams()
  const [freshAsk, setFreshAsk] = useState(false)
  useEffect(() => {
    if (params.get('fresh') !== '1') return
    setReplies([])
    setChosen(undefined)
    localStorage.removeItem(storeKey)
    saveRevisions([])
    setPending(undefined)
    setParams({}, { replace: true })
    setFreshAsk(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  async function use(o: AiOption) {
    if (items.length && replace && !confirm(`Replace the ${items.length} items currently in your plan with "${o.title}"?`)) return
    await applyPlan(trip, o, settings.homeCurrency, replace)
    // Refresh rule-based checklist suggestions now that the itinerary exists.
    await refreshChecklist(trip.id, settings)
    // Activities the chatbot gave no time get one, around the times it did give, so every day reads as a schedule.
    const timed = await fillUntimedTrip(trip.id, settings)
    toast(`"${o.title}" is now your plan${timed ? ` · ${timed} item${timed > 1 ? 's' : ''} given a time` : ''}`)
    // With ChatGPT set up, ideas for each city on the route are asked for in the background, ready in the City planner.
    if (aiReady(getAiConfig()))
      void askAllCityIdeas(trip.id, settings).then(({ done, failed }) => {
        if (done || failed) toast(`✨ Ideas ready for ${plural(done, 'city', 'cities')} in the City planner${failed ? ` · ${failed} couldn't be asked, try again there` : ''}`)
      })
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
        <p className="small muted">
          All 3 options come in one {api ? 'answer' : 'reply'}, with how they differ. If {api ? 'it' : 'the chatbot'} cuts the answer off, the complete options are kept
          and a short follow-up asks for the rest. Then the app asks for the full detail of the option you pick.
        </p>
        {rounds.map((r, i) => (
          <div key={i} className="stack" style={{ gap: 8 }}>
            {i === 0 ? (
              <p className="small">
                <b>3 options ·</b> {api ? 'ask ChatGPT for all three.' : 'copy this prompt into a new chat, then paste the answer below.'}
              </p>
            ) : rounds[i - 1].truncated ? (
              <div className="notice">
                The answer was cut off{r.n > 1 ? ` after option ${r.n - 1}` : ''} — what came complete is kept below. {api ? 'Ask for the rest:' : 'To get the rest, paste this follow-up into the same chat:'}
              </div>
            ) : (
              <div className="notice info">
                <b>{r.n < 3 ? `Options ${r.n}–3` : 'Option 3'} ·</b> only {r.n - 1} came back. {api ? 'Ask for the rest' : <>Copy this follow-up into the <b>same chat</b> and paste the answer below</>} — or pick from the options you have.
              </div>
            )}
            <PromptBox
              prompt={r.prompt}
              history={rounds.slice(0, i).map((x) => ({ prompt: x.prompt, reply: x.text }))}
              onAnswer={(t) => setReply(i, t)}
              autoAsk={i === 0 && freshAsk && !r.text}
            />
            <AnswerBox label={i === 0 ? "Paste the chatbot's answer" : `Answer for ${r.n < 3 ? `options ${r.n}–3` : 'option 3'}`} value={r.text} onChange={(t) => setReply(i, t)} minHeight={90} placeholder={'```json\n{ "compare": …, "options": [ … ] }\n```'} />
            {r.error && <div className="notice error">{r.error}</div>}
          </div>
        ))}
        {done && <p className="small muted">✓ All 3 options received.</p>}
        {replies.length > 0 && (
          <div>
            <button className="btn-sm btn-ghost" onClick={startOver}>
              Start over
            </button>
          </div>
        )}
      </div>

      {options.length > 0 && (
        <>
          <div className="row wrap between">
            <h2>Pick an option</h2>
            {replaceChoice}
          </div>
          <Comparison options={options.map((o) => o.option)} compare={compare} currency={settings.homeCurrency} />
          <div className="grid-3">
            {all.map(({ option, incomplete, revised }, i) => (
              <OptionCard
                key={i}
                n={i + 1}
                option={option}
                incomplete={incomplete}
                revised={revised}
                start={trip.startDate}
                end={trip.endDate}
                currency={settings.homeCurrency}
                trip={trip}
              />
            ))}
          </div>
          {pending && (
            <Revision
              key={`${pending.from}:${pending.changes}`}
              base={all[pending.from].option}
              n={pending.from + 1}
              changes={pending.changes}
              onCancel={() => setPending(undefined)}
              onDone={(reply) => {
                saveRevisions([...revisions, { from: pending.from, changes: pending.changes, reply }])
                setPick(all.length) // the new one is next to look at
                setPending(undefined)
              }}
            />
          )}
          <PlanPicker
            options={all.map((o) => o.option)}
            pick={Math.min(pick, all.length - 1)}
            onPick={setPick}
            disabled={!!pending}
            onUse={use}
            onDetail={(option) => setChosen(option)}
            onRevise={(from, changes) => setPending({ from, changes })}
          />
        </>
      )}
    </div>
  )
}

/** How the options differ, before reading them: the chatbot's own comparison, then a side-by-side of route, moves and cost. */
function Comparison({ options, compare, currency }: { options: AiOption[]; compare: string; currency: string }) {
  if (options.length < 2 && !compare) return null
  return (
    <div className="card stack" style={{ gap: 8 }}>
      <b>How they differ</b>
      {compare && <p className="small" style={{ margin: 0, lineHeight: 1.5 }}>{compare}</p>}
      {options.length > 1 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="small">
            <thead>
              <tr>
                <th>Option</th>
                <th>Best for</th>
                <th className="num">Places</th>
                <th className="num">Moves</th>
                <th className="num">Budget</th>
              </tr>
            </thead>
            <tbody>
              {options.map((o, i) => {
                const { places, moves } = routeShape(o)
                const total = Object.values(o.budget).reduce((s, v) => s + (v || 0), 0)
                return (
                  <tr key={i}>
                    <td>
                      <b>{o.title}</b>
                    </td>
                    <td className="muted">{o.bestFor || '—'}</td>
                    <td className="num">{places}</td>
                    <td className="num">{moves}</td>
                    <td className="num">{total ? money(total, currency) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="tiny muted" style={{ margin: 0 }}>Places: where you sleep along the way. Moves: days you change place.</p>
    </div>
  )
}

function OptionCard({
  n,
  option: o,
  incomplete,
  revised,
  start,
  end,
  currency,
  trip,
}: {
  n: number
  option: AiOption
  incomplete?: boolean
  revised?: { from: number; changes: string }
  start: string
  end: string
  currency: string
  trip: Trip
}) {
  const tripDays = daysBetween(start, end) + 1
  const total = Object.values(o.budget).reduce((s, v) => s + (v || 0), 0)
  const [mapSize, setMapSize] = useState<'small' | 'large' | 'hidden'>('small')
  return (
    <div className="card stack option-card">
      <div>
        <h3>
          <span className="muted">Plan {n} · </span>
          {o.title}
        </h3>
        {revised && (
          <div className="tiny muted">
            ✏️ Revised from plan {revised.from + 1}: {revised.changes}
          </div>
        )}
        {o.bestFor && <div className="small">🎯 {o.bestFor}</div>}
        {o.route.length > 0 && <div className="small muted">{o.route.join(' → ')}</div>}
        {incomplete && (
          <span className="badge planned" style={{ marginTop: 4 }}>
            Cut off · {o.days.length} of {tripDays} days
          </span>
        )}
      </div>
      <div className="chips">
        {(['small', 'large', 'hidden'] as const).map((v) => (
          <button key={v} className={`chip ${mapSize === v ? 'on' : ''}`} onClick={() => setMapSize(v)}>
            {v === 'small' ? 'Small map' : v === 'large' ? 'Large map' : 'Hide map'}
          </button>
        ))}
      </div>
      {mapSize !== 'hidden' && <OptionMap option={o} trip={trip} tall={mapSize === 'large'} />}
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
    </div>
  )
}

/** The request for a revised outline: ChatGPT asked (or the prompt copied), its answer read, then back to the picker. */
function Revision({ base, n, changes, onCancel, onDone }: { base: AiOption; n: number; changes: string; onCancel: () => void; onDone: (reply: string) => void }) {
  const { trip, settings } = useTripCtx()
  const api = useAiWords()
  const [text, setText] = useState('')
  const [error, setError] = useState<string>()
  const prompt = useMemo(() => revisePrompt(trip, settings, base, changes), [trip, settings, base, changes])
  function answer(t: string) {
    setText(t)
    if (!t.trim()) return setError(undefined)
    try {
      parseRevision(t)
      setError(undefined)
      onDone(t)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <div className="card stack">
      <div className="row between wrap">
        <h3>✏️ Revising plan {n}</h3>
        <button className="btn-sm btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div className="notice info">
        <b>Your changes:</b> {changes}
      </div>
      <p className="small">{api ? 'Ask ChatGPT for the revised outline. It appears above as a new plan, with its map.' : 'Copy this prompt into the same chat, then paste the revised outline below. It appears above as a new plan, with its map.'}</p>
      <PromptBox prompt={prompt} onAnswer={answer} />
      <AnswerBox label="Paste the revised outline" value={text} onChange={answer} minHeight={90} placeholder={'```json\n{ "options": [ … ] }\n```'} />
      {error && <div className="notice error">{error}</div>}
    </div>
  )
}

/** At the end of the options: pick a plan from the list, and either go on with it or ask for changes, as many times as you like. */
function PlanPicker({
  options,
  pick,
  onPick,
  disabled,
  onUse,
  onDetail,
  onRevise,
}: {
  options: AiOption[]
  pick: number
  onPick: (i: number) => void
  disabled: boolean
  onUse: (o: AiOption) => void
  onDetail: (o: AiOption) => void
  onRevise: (from: number, changes: string) => void
}) {
  const [changes, setChanges] = useState('')
  const o = options[pick]
  const detailed = o.days.some((d) => d.items.length)
  const wanted = changes.trim()
  return (
    <div className="card stack">
      <h3>Choose your plan</h3>
      <div className="form-grid">
        <label>
          Plan
          <select value={pick} onChange={(e) => onPick(Number(e.target.value))}>
            {options.map((x, i) => (
              <option key={i} value={i}>
                Use plan {i + 1}: {x.title}
              </option>
            ))}
          </select>
        </label>
        <label className="full">
          Anything to change? (optional)
          <textarea
            rows={3}
            value={changes}
            onChange={(e) => setChanges(e.target.value)}
            placeholder="e.g. 4 nights in Rome instead of 2 · add Florence for 2 nights between Rome and Venice · drop Naples"
          />
        </label>
      </div>
      <p className="tiny muted" style={{ margin: 0 }}>
        {wanted ? 'With changes, you get another outline to look at (it is added above as a new plan). Change again as often as you like; the detailed plan comes once you are happy.' : 'Happy with it? Carry on. Or say what to change first.'}
      </p>
      <div className="row wrap">
        {wanted ? (
          <button
            className="btn-primary"
            disabled={disabled}
            onClick={() => {
              onRevise(pick, wanted)
              setChanges('')
            }}
          >
            ✏️ Revise plan {pick + 1} with my changes →
          </button>
        ) : detailed ? (
          <button className="btn-primary" disabled={disabled} onClick={() => onUse(o)}>
            Use plan {pick + 1}
          </button>
        ) : (
          <>
            <button className="btn-primary" disabled={disabled} onClick={() => onDetail(o)}>
              Use plan {pick + 1}: get the detailed plan →
            </button>
            <button className="btn-sm btn-ghost" disabled={disabled} onClick={() => onUse(o)}>
              Use the outline as it is
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Asks for the full plan of one option. If the chatbot's reply is cut off, the days already received are kept
 * and a follow-up prompt asks for the missing ones, in as many rounds as needed.
 */
const DAYS_PER_ASK = 3

function DetailStep({ option, onBack, onUse, replaceChoice }: { option: AiOption; onBack: () => void; onUse: (o: AiOption) => void; replaceChoice: ReactNode }) {
  const api = useAiWords()
  const { trip, settings } = useTripCtx()
  // A revised option can share its title with the one it came from: the answers kept are for this outline only.
  const storeKey = `tm-detail:${trip.id}:${option.title}:${[...JSON.stringify(option.days.map((d) => [d.day, d.city, d.title]))].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)}`
  const [replies, setReplies] = useState<string[]>(() => JSON.parse(localStorage.getItem(storeKey) ?? '[]'))
  // Every day of the trip, even ones a cut-off outline never reached.
  const tripDays = daysBetween(trip.startDate, trip.endDate) + 1
  const expected = Array.from({ length: Math.max(tripDays, ...option.days.map((d) => d.day)) }, (_, i) => i + 1)

  const setReply = (i: number, text: string) => {
    const next = [...replies]
    next[i] = text
    // Editing an earlier reply invalidates the follow-ups built from it.
    const trimmed = next.slice(0, i + 1)
    setReplies(trimmed)
    keep(storeKey, trimmed)
  }

  const { rounds, ok, missing } = detailRounds(replies)
  const merged = mergeDetail(option, ok)
  const detailedCount = expected.length - missing.length

  // Walk through the replies in order, tracking which days are still missing before each one. With ChatGPT set up, each
  // request asks for a few days only: short answers come back quickly and are never cut off.
  function detailRounds(replies: string[]) {
    const rounds: { prompt: string; text: string; result?: ReturnType<typeof parseDetail>; error?: string; missingBefore: number[] }[] = []
    const ok: ReturnType<typeof parseDetail>[] = []
    let missing = expected
    for (let i = 0; i <= replies.length; i++) {
      if (i > 0 && (!rounds[i - 1].result || !missing.length)) break
      const prompt = detailPrompt(trip, settings, option, api ? missing.slice(0, DAYS_PER_ASK) : missing, i > 0)
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
    return { rounds, ok, missing }
  }

  // "Ask ChatGPT for all the days": one short request after another until every day has its detail. An answer that
  // can't be read is asked for once more; the days already received are kept whatever happens.
  const [asking, setAsking] = useState<{ days: number[]; chars: number }>()
  const [askError, setAskError] = useState<string>()
  async function askAll() {
    setAskError(undefined)
    // Keep the answers that could be read (they come first: reading stops at the first one that can't).
    let reps = replies.slice(0, detailRounds(replies).rounds.filter((r) => r.result).length)
    let retried = false
    try {
      for (let guard = 0; guard < expected.length + 4; guard++) {
        const r = detailRounds(reps)
        if (!r.missing.length) break
        const next = r.rounds[r.rounds.length - 1]
        const days = r.missing.slice(0, DAYS_PER_ASK)
        setAsking({ days, chars: 0 })
        const text = await askAI([{ role: 'user', content: next.prompt }], (chars) => setAsking({ days, chars }))
        const after = detailRounds([...reps, text])
        if (!after.rounds[reps.length]?.result || after.missing.length >= r.missing.length) {
          if (retried) throw new Error(`ChatGPT's answer for day ${days.join(', ')} couldn't be used twice in a row. Try again, or pick another model in Settings.`)
          retried = true
          continue
        }
        retried = false
        reps = [...reps, text]
        setReplies(reps)
        keep(storeKey, reps)
      }
    } catch (e) {
      setAskError((e as Error).message)
    } finally {
      setAsking(undefined)
    }
  }

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
        {api && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="row wrap">
              <button className="btn-primary" disabled={!!asking || !missing.length} onClick={askAll}>
                {asking
                  ? `⏳ Days ${asking.days[0]}${asking.days.length > 1 ? `–${asking.days[asking.days.length - 1]}` : ''} of ${expected.length}${asking.chars ? ` · ${asking.chars.toLocaleString()} characters` : ' · ChatGPT is thinking'}…`
                  : !missing.length
                    ? '✓ Every day has its detail'
                    : detailedCount
                      ? `✨ Ask ChatGPT for the other ${missing.length} days`
                      : `✨ Ask ChatGPT for all ${expected.length} days`}
              </button>
            </div>
            <p className="tiny muted" style={{ margin: 0 }}>
              It asks for {DAYS_PER_ASK} days at a time, so each answer is quick, and carries on by itself. If the connection drops, it tries again; what came back is kept.
            </p>
            {askError && <div className="notice error">{askError}</div>}
          </div>
        )}
        {!api && rounds.map((r, i) => (
          <div key={i} className="stack" style={{ gap: 8 }}>
            {i === 0 ? (
              <p className="small">
                <b>1 ·</b> {api ? 'Ask ChatGPT for the day-by-day detail.' : 'Copy this prompt into the chatbot (the same chat is fine), then paste its answer below.'}
              </p>
            ) : (
              <div className="notice info">
                {i === 1 ? 'The answer stopped early' : 'Still some days missing'}: days {r.missingBefore.join(', ')} have no detail yet.{' '}
                {api ? 'Ask again for the rest.' : <>Copy this follow-up prompt into the <b>same chat</b> and paste the answer below.</>}
              </div>
            )}
            <PromptBox prompt={r.prompt} history={rounds.slice(0, i).map((x) => ({ prompt: x.prompt, reply: x.text }))} onAnswer={(t) => setReply(i, t)} />
            <AnswerBox label={i === 0 ? "Paste the chatbot's answer" : `Answer ${i + 1}`} value={r.text} onChange={(t) => setReply(i, t)} placeholder='{"days": [ … ]}' />
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
          {missing.length > 0 && (
            <p className="small muted">
              Days without detail ({missing.join(', ')}) will use the outline's highlights as ideas — you can still fill them in later.
            </p>
          )}
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
      {email.trim() && <PromptBox prompt={bookingPrompt(trip, settings, email)} onAnswer={setAnswer} />}
      <AnswerBox label="2 · Paste the chatbot's answer" value={answer} onChange={setAnswer} placeholder='{"items": [ … ]}' />
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
