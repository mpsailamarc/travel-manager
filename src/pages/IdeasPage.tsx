import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { applyBookings, applyPlan, applyTemplate, bookingPrompt, CHATBOTS, detailPrompt, mergeDetail, outlinePrompt, outlineRounds, parseBookings, parseDetail, parseRevision, revisePrompt, routeShape, type AiOption } from '../lib/ai'
import { OptionMap } from '../components/OptionMap'
import { refreshChecklist } from '../lib/checklist'
import { BUDGET_LABELS } from '../lib/budget'
import { addDays, daysBetween, formatDate } from '../lib/dates'
import { money } from '../lib/format'
import { countryLabel } from '../lib/countries'
import { KIND_META } from '../components/kinds'
import { copyText, toast } from '../components/ui'
import { active, aiReady, askAI, getAiConfig, useAiConfig } from '../lib/openai'
import { askAllCityIdeas } from '../lib/cityideas'
import { fillUntimedTrip } from '../lib/favorites'
import { BUDGET_LEVELS, STYLES } from './TripFields'
import { useTripCtx } from './TripLayout'
import { saveLocal } from '../lib/storage'
import type { Trip } from '../types'
import { t, tn } from '../i18n'

type Tab = 'ideas' | 'bookings' | 'template'

export default function IdeasPage() {
  // A link can open a part directly: "Import a booking email" from Where you sleep or Docs.
  const [params] = useSearchParams()
  const [tab, setTab] = useState<Tab>(() => (['ideas', 'bookings', 'template'].includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'ideas'))
  return (
    <div className="stack-lg">
      <div className="chips">
        <button className={`chip ${tab === 'ideas' ? 'on' : ''}`} onClick={() => setTab('ideas')}>
          {t('✨ Itinerary ideas')}
        </button>
        <button className={`chip ${tab === 'bookings' ? 'on' : ''}`} onClick={() => setTab('bookings')}>
          {t('📧 Import booking emails')}
        </button>
        <button className={`chip ${tab === 'template' ? 'on' : ''}`} onClick={() => setTab('template')}>
          {t('🧱 Quick template (no AI)')}
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
  const steps = api ? [t('Press “Ask ChatGPT”'), t('It fills in the answer for you'), t('Check it and use it')] : [t('Copy the prompt'), t('Paste it in a free chatbot'), t('Paste its answer back here')]
  return (
    <div className="info-grid">
      {steps.map((v, i) => (
        <div key={i} className="info-tile">
          <div className="k">{t('Step {n}', { n: i + 1 })}</div>
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
        {t('📋 Copy the prompt')}
      </button>
      {CHATBOTS.map((c) => (
        <a key={c.name} className="btn" href={c.url} target="_blank" rel="noreferrer">
          {t('Open {name} ↗', { name: c.name })}
        </a>
      ))}
    </div>
  )

  if (api)
    return (
      <div className="stack" style={{ gap: 8 }}>
        <div className="row wrap">
          <button className="btn-primary" disabled={busy} onClick={ask}>
            {busy ? (chars ? t('⏳ ChatGPT is writing… {chars} characters', { chars: chars.toLocaleString() }) : t('⏳ ChatGPT is thinking…')) : t('✨ Ask ChatGPT')}
          </button>
          <span className="tiny muted">{t('uses your API key · {model}', { model: active(cfg).model })}</span>
        </div>
        {error && <div className="notice error">{error}</div>}
        <details>
          <summary className="small muted">{t('What is sent')}</summary>
          <pre className="prompt">{prompt}</pre>
        </details>
      </div>
    )
  return (
    <div className="stack" style={{ gap: 8 }}>
      {copyRow}
      <details>
        <summary className="small muted">{t('See the prompt')}</summary>
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
      <summary className="small muted">{t("Show ChatGPT's answer (you can edit it)")}</summary>
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
  if (!saveLocal(key, JSON.stringify(replies))) toast(t("This device's storage is full: the answer works now but won't be kept if you leave the page"))
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
  // Which plans show their detail: all by default, then the ones you folded or unfolded.
  const [fold, setFold] = useState<{ open: boolean; except: number[] }>({ open: true, except: [] })
  const isOpen = (i: number) => fold.open !== fold.except.includes(i)
  const toggle = (i: number) => setFold({ ...fold, except: fold.except.includes(i) ? fold.except.filter((x) => x !== i) : [...fold.except, i] })
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
    if (!confirm(t('Clear the pasted answers and start again?'))) return
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
    if (items.length && replace && !confirm(tn(items.length, 'Replace the {n} item currently in your plan with "{title}"?', 'Replace the {n} items currently in your plan with "{title}"?', { title: o.title }))) return
    await applyPlan(trip, o, settings.homeCurrency, replace)
    // Refresh rule-based checklist suggestions now that the itinerary exists.
    await refreshChecklist(trip.id, settings)
    // Activities the chatbot gave no time get one, around the times it did give, so every day reads as a schedule.
    const timed = await fillUntimedTrip(trip.id, settings)
    toast(t('"{title}" is now your plan', { title: o.title }) + (timed ? ` · ${tn(timed, '{n} item given a time', '{n} items given a time')}` : ''))
    // With ChatGPT set up, ideas for each city on the route are asked for in the background, ready in the City planner.
    if (aiReady(getAiConfig()))
      void askAllCityIdeas(trip.id, settings).then(({ done, failed }) => {
        if (done || failed) toast(tn(done, '✨ Ideas ready for {n} city in the City planner', '✨ Ideas ready for {n} cities in the City planner') + (failed ? ` · ${t("{n} couldn't be asked, try again there", { n: failed })}` : ''))
      })
    navigate('../plan')
  }

  const replaceChoice = items.length > 0 && (
    <div className="row">
      <label className="inline small">
        <input type="radio" checked={replace} onChange={() => setReplace(true)} /> {t('Replace my plan')}
      </label>
      <label className="inline small">
        <input type="radio" checked={!replace} onChange={() => setReplace(false)} /> {t('Add to it')}
      </label>
    </div>
  )

  if (chosen) return <DetailStep option={chosen} onBack={() => setChosen(undefined)} onUse={use} replaceChoice={replaceChoice} />

  return (
    <div className="stack-lg">
      <div className="card stack">
        <div className="row between wrap">
          <h2>{t('Get 3 itinerary options')}</h2>
          <span className="small muted">{t('Free · uses any chatbot you like')}</span>
        </div>
        <div className="small">
          <b>{t('Your brief:')}</b> {trip.countryCodes.map(countryLabel).join(', ') || t('open destination')}
          {trip.cities.length > 0 && ` (${trip.cities.join(', ')})`} · {formatDate(trip.startDate)} → {formatDate(trip.endDate)} · {tn(trip.travellers.length, '{n} traveller', '{n} travellers')}
          {trip.travellers.some((x) => x.type === 'child') && t(' incl. kids aged {ages}', { ages: trip.travellers.filter((x) => x.type === 'child').map((x) => x.age).join(', ') })} ·{' '}
          {STYLES[trip.style].label} · {BUDGET_LEVELS[trip.budgetLevel].label}
          {trip.interests.length > 0 && ` · ${trip.interests.join(', ')}`}
          <span className="muted"> {t('— change it with “Trip details” above.')}</span>
        </div>
        <Steps />
        <p className="small muted">
          {api
            ? t('All 3 options come in one answer, with how they differ. If it cuts the answer off, the complete options are kept and a short follow-up asks for the rest. Then the app asks for the full detail of the option you pick.')
            : t('All 3 options come in one reply, with how they differ. If the chatbot cuts the answer off, the complete options are kept and a short follow-up asks for the rest. Then the app asks for the full detail of the option you pick.')}
        </p>
        {rounds.map((r, i) => (
          <div key={i} className="stack" style={{ gap: 8 }}>
            {i === 0 ? (
              <p className="small">
                <b>{t('3 options ·')}</b> {api ? t('ask ChatGPT for all three.') : t('copy this prompt into a new chat, then paste the answer below.')}
              </p>
            ) : rounds[i - 1].truncated ? (
              <div className="notice">
                {r.n > 1 ? t('The answer was cut off after option {n} — what came complete is kept below.', { n: r.n - 1 }) : t('The answer was cut off — what came complete is kept below.')}{' '}
                {api ? t('Ask for the rest:') : t('To get the rest, paste this follow-up into the same chat:')}
              </div>
            ) : (
              <div className="notice info">
                <b>{r.n < 3 ? t('Options {n}–3 ·', { n: r.n }) : t('Option 3 ·')}</b> {t('only {n} came back.', { n: r.n - 1 })}{' '}
                {api ? t('Ask for the rest — or pick from the options you have.') : t('Copy this follow-up into the same chat and paste the answer below — or pick from the options you have.')}
              </div>
            )}
            <PromptBox
              prompt={r.prompt}
              history={rounds.slice(0, i).map((x) => ({ prompt: x.prompt, reply: x.text }))}
              onAnswer={(x) => setReply(i, x)}
              autoAsk={i === 0 && freshAsk && !r.text}
            />
            <AnswerBox label={i === 0 ? t("Paste the chatbot's answer") : r.n < 3 ? t('Answer for options {n}–3', { n: r.n }) : t('Answer for option 3')} value={r.text} onChange={(x) => setReply(i, x)} minHeight={90} placeholder={'```json\n{ "compare": …, "options": [ … ] }\n```'} />
            {r.error && <div className="notice error">{r.error}</div>}
          </div>
        ))}
        {done && <p className="small muted">{t('✓ All 3 options received.')}</p>}
        {replies.length > 0 && (
          <div>
            <button className="btn-sm btn-ghost" onClick={startOver}>
              {t('Start over')}
            </button>
          </div>
        )}
      </div>

      {options.length > 0 && (
        <>
          <div className="row wrap between">
            <h2>{t('Pick an option')}</h2>
            {replaceChoice}
          </div>
          <Comparison options={options.map((o) => o.option)} compare={compare} currency={settings.homeCurrency} />
          {all.length > 1 && (
            <div className="chips">
              <button className={`chip ${!fold.open && !fold.except.length ? 'on' : ''}`} onClick={() => setFold({ open: false, except: [] })}>
                {t('▸ Collapse all')}
              </button>
              <button className={`chip ${fold.open && !fold.except.length ? 'on' : ''}`} onClick={() => setFold({ open: true, except: [] })}>
                {t('▾ Expand all')}
              </button>
            </div>
          )}
          <div className="grid-3">
            {all.map(({ option, incomplete, revised }, i) => (
              <OptionCard
                key={i}
                n={i + 1}
                open={isOpen(i)}
                onToggle={() => toggle(i)}
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
      <b>{t('How they differ')}</b>
      {compare && <p className="small" style={{ margin: 0, lineHeight: 1.5 }}>{compare}</p>}
      {options.length > 1 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="small">
            <thead>
              <tr>
                <th>{t('Option')}</th>
                <th>{t('Best for')}</th>
                <th className="num">{t('Places')}</th>
                <th className="num">{t('Moves')}</th>
                <th className="num">{t('Budget')}</th>
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
      <p className="tiny muted" style={{ margin: 0 }}>{t('Places: where you sleep along the way. Moves: days you change place.')}</p>
    </div>
  )
}

function OptionCard({
  n,
  open,
  onToggle,
  option: o,
  incomplete,
  revised,
  start,
  end,
  currency,
  trip,
}: {
  n: number
  open: boolean
  onToggle: () => void
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
  const [allDays, setAllDays] = useState(false)
  return (
    <div className="card stack option-card">
      <div>
        <div className="row" style={{ alignItems: 'flex-start', gap: 6 }}>
          <button className="btn-sm btn-ghost" style={{ fontSize: '1.1rem', lineHeight: 1, padding: '4px 8px' }} aria-expanded={open} aria-label={open ? t('Collapse plan {n}', { n }) : t('Expand plan {n}', { n })} title={open ? t('Hide the detail of this plan') : t('Show the detail of this plan')} onClick={onToggle}>
            {open ? '▾' : '▸'}
          </button>
          <h3 className="grow" style={{ cursor: 'pointer' }} onClick={onToggle}>
            <span className="muted">{t('Plan {n} · ', { n })}</span>
            {o.title}
          </h3>
        </div>
        {revised && (
          <div className="tiny muted">
            {t('✏️ Revised from plan {n}: {changes}', { n: revised.from + 1, changes: revised.changes })}
          </div>
        )}
        {o.bestFor && <div className="small">🎯 {o.bestFor}</div>}
        {o.route.length > 0 && <div className="small muted">{o.route.join(' → ')}</div>}
        {incomplete && (
          <span className="badge planned" style={{ marginTop: 4 }}>
            {t('Cut off · {n} of {total} days', { n: o.days.length, total: tripDays })}
          </span>
        )}
      </div>
      {open && (
        <>
      <div className="chips">
        {(['small', 'large', 'hidden'] as const).map((v) => (
          <button key={v} className={`chip ${mapSize === v ? 'on' : ''}`} onClick={() => setMapSize(v)}>
            {v === 'small' ? t('Small map') : v === 'large' ? t('Large map') : t('Hide map')}
          </button>
        ))}
      </div>
      {mapSize !== 'hidden' && <OptionMap option={o} trip={trip} tall={mapSize === 'large'} />}
      <p className="small">{o.summary}</p>
      <ul className="option-days" style={{ paddingLeft: 18, margin: 0, maxHeight: allDays ? 'none' : undefined }}>
        {o.days.map((d) => (
          <li key={d.day}>
            <b>
              {t('Day {n}', { n: d.day })} · {formatDate(addDays(start, d.day - 1), { weekday: 'short', day: 'numeric' })}
            </b>{' '}
            {d.city && <span className="muted">{d.city}</span>}
            <div className="muted">{d.items.length ? d.items.map((it) => `${KIND_META[it.kind].emoji} ${it.title}`).join(' · ') : [d.title, ...d.highlights].filter(Boolean).join(' · ')}</div>
          </li>
        ))}
      </ul>
      {o.days.length > 5 && (
        <button className="btn-sm btn-ghost" onClick={() => setAllDays(!allDays)}>
          {allDays ? t('⇡ Fewer lines') : t('⇣ Show all {n} days', { n: o.days.length })}
        </button>
      )}
        </>
      )}
      {total > 0 && (
        <div className="small">
          <b>{t('Budget ≈ {amount}', { amount: money(total, currency) })}</b>
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
          <summary className="small">{t('Tips ({n})', { n: o.tips.length })}</summary>
          <ul className="small" style={{ paddingLeft: 18 }}>
            {o.tips.map((tip, i) => (
              <li key={i}>{tip}</li>
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
  function answer(reply: string) {
    setText(reply)
    if (!reply.trim()) return setError(undefined)
    try {
      parseRevision(reply)
      setError(undefined)
      onDone(reply)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <div className="card stack">
      <div className="row between wrap">
        <h3>{t('✏️ Revising plan {n}', { n })}</h3>
        <button className="btn-sm btn-ghost" onClick={onCancel}>
          {t('Cancel')}
        </button>
      </div>
      <div className="notice info">
        <b>{t('Your changes:')}</b> {changes}
      </div>
      <p className="small">{api ? t('Ask ChatGPT for the revised outline. It appears above as a new plan, with its map.') : t('Copy this prompt into the same chat, then paste the revised outline below. It appears above as a new plan, with its map.')}</p>
      <PromptBox prompt={prompt} onAnswer={answer} />
      <AnswerBox label={t('Paste the revised outline')} value={text} onChange={answer} minHeight={90} placeholder={'```json\n{ "options": [ … ] }\n```'} />
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
      <h3>{t('Choose your plan')}</h3>
      <div className="form-grid">
        <label>
          {t('Plan')}
          <select value={pick} onChange={(e) => onPick(Number(e.target.value))}>
            {options.map((x, i) => (
              <option key={i} value={i}>
                {t('Use plan {n}: {title}', { n: i + 1, title: x.title })}
              </option>
            ))}
          </select>
        </label>
        <label className="full">
          {t('Anything to change? (optional)')}
          <textarea
            rows={3}
            value={changes}
            onChange={(e) => setChanges(e.target.value)}
            placeholder={t('e.g. 4 nights in Rome instead of 2 · add Florence for 2 nights between Rome and Venice · drop Naples')}
          />
        </label>
      </div>
      <p className="tiny muted" style={{ margin: 0 }}>
        {wanted ? t('With changes, you get another outline to look at (it is added above as a new plan). Change again as often as you like; the detailed plan comes once you are happy.') : t('Happy with it? Carry on. Or say what to change first.')}
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
            {t('✏️ Revise plan {n} with my changes →', { n: pick + 1 })}
          </button>
        ) : detailed ? (
          <button className="btn-primary" disabled={disabled} onClick={() => onUse(o)}>
            {t('Use plan {n}', { n: pick + 1 })}
          </button>
        ) : (
          <>
            <button className="btn-primary" disabled={disabled} onClick={() => onDetail(o)}>
              {t('Use plan {n}: get the detailed plan →', { n: pick + 1 })}
            </button>
            <button className="btn-sm btn-ghost" disabled={disabled} onClick={() => onUse(o)}>
              {t('Use the outline as it is')}
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
          if (retried) throw new Error(t("ChatGPT's answer for day {days} couldn't be used twice in a row. Try again, or pick another model in Settings.", { days: days.join(', ') }))
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
          {t('← Back to the options')}
        </button>
        {replaceChoice}
      </div>
      <div className="card stack">
        <h2>{t('Detailed plan: {title}', { title: option.title })}</h2>
        <p className="small muted">{option.route.join(' → ')} · {tn(expected.length, '{n} day', '{n} days')}</p>
        {api && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="row wrap">
              <button className="btn-primary" disabled={!!asking || !missing.length} onClick={askAll}>
                {asking
                  ? t('⏳ Days {range} of {total}', { range: asking.days.length > 1 ? `${asking.days[0]}–${asking.days[asking.days.length - 1]}` : asking.days[0], total: expected.length }) +
                    (asking.chars ? t(' · {chars} characters', { chars: asking.chars.toLocaleString() }) : t(' · ChatGPT is thinking')) +
                    '…'
                  : !missing.length
                    ? t('✓ Every day has its detail')
                    : detailedCount
                      ? t('✨ Ask ChatGPT for the other {n} days', { n: missing.length })
                      : t('✨ Ask ChatGPT for all {n} days', { n: expected.length })}
              </button>
            </div>
            <p className="tiny muted" style={{ margin: 0 }}>
              {t('It asks for {n} days at a time, so each answer is quick, and carries on by itself. If the connection drops, it tries again; what came back is kept.', { n: DAYS_PER_ASK })}
            </p>
            {askError && <div className="notice error">{askError}</div>}
          </div>
        )}
        {!api && rounds.map((r, i) => (
          <div key={i} className="stack" style={{ gap: 8 }}>
            {i === 0 ? (
              <p className="small">
                <b>{t('1 ·')}</b> {api ? t('Ask ChatGPT for the day-by-day detail.') : t('Copy this prompt into the chatbot (the same chat is fine), then paste its answer below.')}
              </p>
            ) : (
              <div className="notice info">
                {t('{reason}: days {days} have no detail yet.', { reason: i === 1 ? t('The answer stopped early') : t('Still some days missing'), days: r.missingBefore.join(', ') })}{' '}
                {api ? t('Ask again for the rest.') : t('Copy this follow-up prompt into the same chat and paste the answer below.')}
              </div>
            )}
            <PromptBox prompt={r.prompt} history={rounds.slice(0, i).map((x) => ({ prompt: x.prompt, reply: x.text }))} onAnswer={(x) => setReply(i, x)} />
            <AnswerBox label={i === 0 ? t("Paste the chatbot's answer") : t('Answer {n}', { n: i + 1 })} value={r.text} onChange={(x) => setReply(i, x)} placeholder='{"days": [ … ]}' />
            {r.error && <div className="notice error">{r.error}</div>}
            {r.result && (
              <p className="small muted">
                {tn(r.result.days.filter((d) => d.items.length).length, '✓ Got {n} day', '✓ Got {n} days')}
                {r.result.truncated && t(' — the answer was cut off, so the last unfinished day was left out')}.
              </p>
            )}
          </div>
        ))}
      </div>

      {detailedCount > 0 && (
        <div className="card stack">
          <div className="row between wrap">
            <h3>
              {t('{n} of {total} days detailed', { n: detailedCount, total: expected.length })}
            </h3>
            <button className="btn-primary" onClick={() => onUse(merged)}>
              {t('Use this plan')}
            </button>
          </div>
          {missing.length > 0 && (
            <p className="small muted">
              {t("Days without detail ({days}) will use the outline's highlights as ideas — you can still fill them in later.", { days: missing.join(', ') })}
            </p>
          )}
          <ul className="option-days" style={{ paddingLeft: 18, margin: 0, maxHeight: 360 }}>
            {merged.days.map((d) => (
              <li key={d.day}>
                <b>
                  {t('Day {n}', { n: d.day })} · {formatDate(addDays(trip.startDate, d.day - 1), { weekday: 'short', day: 'numeric' })}
                </b>{' '}
                <span className="muted">{d.city}</span>
                <div className="muted">
                  {d.items.length ? d.items.map((it) => `${it.time ? it.time + ' ' : ''}${KIND_META[it.kind].emoji} ${it.title}`).join(' · ') : t('(outline) {highlights}', { highlights: d.highlights.join(' · ') })}
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
    toast(tn(parsed.items.length, 'Added {n} booking to the plan', 'Added {n} bookings to the plan'))
    navigate('../plan')
  }

  return (
    <div className="card stack" style={{ maxWidth: 820 }}>
      <h2>{t('Turn confirmation emails into plan items')}</h2>
      <p className="small muted">
        {t("Paste the text of flight, train, hotel or ticket confirmations. Remove anything you don't want to send to the chatbot (e.g. card details, passport numbers) — only dates, times, places and booking references are needed.")}
      </p>
      <label>
        {t('1 · Confirmation text')}
        <textarea value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('Paste one or more confirmation emails…')} />
      </label>
      {email.trim() && <PromptBox prompt={bookingPrompt(trip, settings, email)} onAnswer={setAnswer} />}
      <AnswerBox label={t("2 · Paste the chatbot's answer")} value={answer} onChange={setAnswer} placeholder='{"items": [ … ]}' />
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
            <div className="notice">{t("Some bookings fall outside the trip dates — they'll appear at the bottom of the Plan until you adjust the dates.")}</div>
          )}
          <div>
            <button className="btn-primary" onClick={add}>
              {tn(parsed.items.length, 'Add {n} booking as “Booked”', 'Add {n} bookings as “Booked”')}
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
    if (items.length && !confirm(t('Add template items to your existing plan?'))) return
    await applyTemplate(trip)
    toast(t('Skeleton plan created'))
    navigate('../plan')
  }
  return (
    <div className="card stack" style={{ maxWidth: 720 }}>
      <h2>{t('Start from a simple skeleton')}</h2>
      <p className="small">
        {t('Spreads your days evenly across {places}, with travel between places and one accommodation per stop. Everything is marked as an idea so you can fill in the details yourself. Works completely offline.', { places: trip.cities.length ? trip.cities.join(', ') : t('your destinations') })}
      </p>
      {!trip.cities.length && <div className="notice info">{t('Tip: add the cities you want to visit (in order) in “Trip details” first.')}</div>}
      <div>
        <button className="btn-primary" onClick={go}>
          {t('Create the skeleton')}
        </button>
      </div>
    </div>
  )
}
