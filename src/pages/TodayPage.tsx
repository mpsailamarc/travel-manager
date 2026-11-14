import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { db, touchTrip } from '../db'
import type { Item } from '../types'
import { addDays, dateRange, daysBetween, formatDate, formatDuration, hhmmToMin, nowHHMM, today } from '../lib/dates'
import { forecast, weatherEmoji } from '../lib/apis'
import { useAsync, useNow } from '../lib/hooks'
import { sortItems } from '../lib/hooks'
import { applyDayReplan, CHATBOTS, parseDayItems, replanPrompt } from '../lib/ai'
import { ItemRow, itemSubtitle } from '../components/ItemRow'
import { ItemEditor } from '../components/ItemEditor'
import { DayProportions, DayTimeline } from '../components/DayTimeline'
import { buildDayView, journeyNote } from '../lib/dayview'
import { durationMin } from '../lib/tz'
import { planRipple } from '../lib/ripple'
import { KIND_META, isTransport, needsBooking } from '../components/kinds'
import { copyText, Empty, Modal, toast } from '../components/ui'
import LazyMap from '../components/LazyMap'
import { BackupIdeas } from '../components/BackupIdeas'
import { tripPhase, useTripCtx } from './TripLayout'

export default function TodayPage() {
  const { trip, items, days } = useTripCtx()
  const [params, setParams] = useSearchParams()
  const realToday = today()
  const ph = tripPhase(trip)
  const date = params.get('date') ?? (ph.phase === 'during' ? realToday : ph.phase === 'before' ? trip.startDate : trip.endDate)
  const isToday = date === realToday
  const now = useNow()
  const nowStr = nowHHMM()
  const day = days.find((d) => d.date === date)
  const dayItems = useMemo(() => sortItems(items.filter((i) => i.date === date)), [items, date])
  // The calendar in this day's own time (a flight from another zone is converted; one landing today shows its landing part).
  const view = useMemo(() => buildDayView(items, date, { trip, days }), [items, date, trip, days])
  const [mode, setViewState] = useState<'timeline' | 'list'>(() => (localStorage.getItem('tm-day-view') === 'list' ? 'list' : 'timeline'))
  const setMode = (v: 'timeline' | 'list') => {
    setViewState(v)
    localStorage.setItem('tm-day-view', v)
  }
  const [editing, setEditing] = useState<(Partial<Item> & { date: string }) | null>(null)
  const [replan, setReplan] = useState(false)
  const dayNo = daysBetween(trip.startDate, date) + 1
  const dates = dateRange(trip.startDate, trip.endDate)
  const chipsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chipsRef.current?.querySelector('.on')?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [date])

  const open = dayItems.filter((i) => i.status !== 'done' && i.status !== 'skipped')
  // An item is "now" when we're between its start and end time; otherwise show the next one coming up.
  const current = isToday ? open.find((i) => i.startTime && i.endTime && i.startTime <= nowStr && nowStr < i.endTime) : undefined
  const next = current ?? (isToday ? open.find((i) => i.startTime && i.startTime >= nowStr) ?? open.find((i) => !i.startTime) : open[0])
  const transports = dayItems.filter((i) => isTransport(i.kind) && i.kind !== 'taxi')
  const tonight = items.find((i) => i.kind === 'stay' && i.date <= date && date < addDays(i.date, i.nights ?? 1))

  async function setStatus(it: Item, status: Item['status']) {
    await db.items.update(it.id, { status: it.status === status ? 'planned' : status })
    await touchTrip(trip.id)
  }

  async function move(it: Item, dir: -1 | 1) {
    const idx = dayItems.indexOf(it)
    const other = dayItems[idx + dir]
    if (!other) return
    // Swap positions; if both are timed, swap times too so "do this first" just works.
    await db.items.bulkUpdate([
      { key: it.id, changes: { order: other.order, startTime: other.startTime && it.startTime ? other.startTime : it.startTime } },
      { key: other.id, changes: { order: it.order, startTime: other.startTime && it.startTime ? it.startTime : other.startTime } },
    ])
  }

  async function postpone(it: Item) {
    const tomorrow = addDays(it.date, 1)
    if (tomorrow > trip.endDate) return toast('That’s the last day of the trip')
    await db.items.update(it.id, { date: tomorrow, startTime: undefined })
    toast(`Moved to ${formatDate(tomorrow)}`)
  }

  /** Dragged on the calendar: save the new times, and offer to undo or to push overlapping items back. */
  async function moveOnCalendar(it: Item, times: { startTime: string; endTime?: string }) {
    const before = { startTime: it.startTime, endTime: it.endTime }
    await db.items.update(it.id, { startTime: times.startTime, endTime: times.endTime ?? it.endTime })
    await touchTrip(trip.id)
    const shown = `${it.title}: ${times.startTime}${times.endTime ? `–${times.endTime}` : ''}`
    const ripple = planRipple(await db.items.where({ tripId: trip.id, date: it.date }).toArray(), { id: it.id, startTime: times.startTime, endTime: times.endTime }, before)
    const undo = async () => {
      await db.items.update(it.id, { startTime: before.startTime, endTime: before.endTime })
      await touchTrip(trip.id)
    }
    if (ripple.moves.length && !ripple.blockedBy) {
      toast(`${shown} · now overlaps ${ripple.moves.length} item${ripple.moves.length > 1 ? 's' : ''}`, {
        label: 'Push them back',
        run: async () => {
          await db.items.bulkUpdate(ripple.moves.map((m) => ({ key: m.item.id, changes: { startTime: m.start, endTime: m.end } })))
          await touchTrip(trip.id)
          toast('Pushed back', { label: 'Undo', run: async () => {
            await db.items.bulkUpdate(ripple.moves.map((m) => ({ key: m.item.id, changes: { startTime: m.item.startTime, endTime: m.item.endTime } })))
            await undo()
          } })
        },
      })
    } else {
      toast(shown, { label: 'Undo', run: undo })
    }
  }

  const goto = (d: string) => {
    setParams(d === realToday ? {} : { date: d })
    // Switching day from far down the page: start the new day from its top, just under the pinned day selector.
    setTimeout(() => {
      const hero = document.querySelector('.hero')
      const strip = document.querySelector('.day-strip')
      if (!hero || !strip) return
      const y = hero.getBoundingClientRect().top + window.scrollY - strip.getBoundingClientRect().bottom - 8
      if (window.scrollY > y) window.scrollTo({ top: Math.max(0, y) })
    }, 60)
  }

  return (
    <div className="stack-lg">
      {ph.phase !== 'during' && !params.get('date') && (
        <div className="notice info">
          {ph.phase === 'before'
            ? `Your trip starts in ${ph.daysToGo} day${ph.daysToGo === 1 ? '' : 's'}. This is a preview of how each day will look while you travel.`
            : 'This trip is over — here is how each day looked.'}
        </div>
      )}

      <div className="weather-strip day-strip" ref={chipsRef}>
        {dates.map((d, i) => (
          <button key={d} className={`chip ${d === date ? 'on' : ''}`} onClick={() => goto(d)} style={{ flex: 'none' }}>
            {d === realToday ? 'Today' : `Day ${i + 1}`} · {formatDate(d, { weekday: 'short', day: 'numeric' })}
          </button>
        ))}
      </div>

      <div className="grid-2 wide-left">
        <div className="stack">
          <div className="card hero stack">
            <div className="row between">
              <div>
                <div className="small muted">
                  Day {dayNo} of {dates.length} · {formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}
                </div>
                <h2 style={{ fontSize: '1.4rem', marginTop: 2 }}>{[day?.city, day?.title].filter(Boolean).join(' — ') || 'Your day'}</h2>
              </div>
              <Weather lat={day?.lat} lon={day?.lon} date={date} />
            </div>
            {next ? (
              <div className="next-up">
                <div className="big-icon">{KIND_META[next.kind].emoji}</div>
                <div className="grow">
                  <div className="small muted">{current ? `Now · until ${current.endTime}` : isToday ? 'Next up' : 'First up'}</div>
                  <div className="strong" style={{ fontSize: '1.1rem' }}>
                    {next.startTime && `${next.startTime} · `}
                    {next.title}
                  </div>
                  {itemSubtitle(next) && <div className="small muted">{itemSubtitle(next)}</div>}
                </div>
                {isToday && !current && next.startTime && <Countdown to={next.startTime} now={now} />}
              </div>
            ) : (
              <p className="muted">{dayItems.length ? 'All done for today 🎉' : 'Nothing planned — a free day.'}</p>
            )}
            <div className="row wrap">
              <button onClick={() => setEditing({ date })}>+ Add</button>
              <Link className="btn" to={`../walk?date=${date}`}>
                🚶 Walk
              </Link>
              <button onClick={() => setReplan(true)}>✨ Replan</button>
            </div>
          </div>

          {day && <BackupIdeas tripId={trip.id} day={day} />}

          {transports.length > 0 && (
            <div className="card stack" style={{ gap: 8 }}>
              <h3>🧭 Travel today</h3>
              {transports.map((t) => (
                <div key={t.id} className="row-top">
                  <span style={{ fontSize: '1.4rem' }}>{KIND_META[t.kind].emoji}</span>
                  <div className="grow">
                    <div className="strong">
                      {t.startTime}
                      {t.endTime && `–${t.endTime}`} {t.title}
                    </div>
                    <div className="small muted">
                      {t.from?.name} → {t.to?.name}
                      {t.startTime && t.endTime && ` · ${formatDuration((durationMin(t, { trip, days }) ?? 0) * 60)}`}
                      {journeyNote(t, { trip, days }) && ` · 🌏 ${journeyNote(t, { trip, days })}`}
                    </div>
                    {t.bookingRef && (
                      <div className="small">
                        Booking ref <b style={{ fontFamily: 'ui-monospace, monospace', letterSpacing: '0.05em' }}>{t.bookingRef}</b>
                      </div>
                    )}
                  </div>
                  {(t.status === 'booked' || t.status === 'done' || needsBooking(t.kind)) && (
                    <span className={`badge ${t.status}`}>{t.status === 'booked' ? 'Booked' : t.status === 'done' ? 'Done' : 'Not booked'}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="card">
            <div className="card-title">
              <h3>Plan for the day</h3>
              <div className="row wrap" style={{ gap: 8 }}>
                <span className="small muted nowrap">
                  {dayItems.filter((i) => i.status === 'done').length}/{dayItems.length} done
                </span>
                {dayItems.length > 0 && (
                  <div className="chips" style={{ flexWrap: 'nowrap' }}>
                    <button className={`chip ${mode === 'timeline' ? 'on' : ''}`} onClick={() => setMode('timeline')}>
                      🕒 Timeline
                    </button>
                    <button className={`chip ${mode === 'list' ? 'on' : ''}`} onClick={() => setMode('list')}>
                      ☰ List
                    </button>
                  </div>
                )}
              </div>
            </div>
            {dayItems.length === 0 && <Empty emoji="☕" title="Free day">Add something, build a walk, or just wander.</Empty>}
            {dayItems.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <DayProportions entries={view.entries} />
              </div>
            )}
            {mode === 'timeline' && dayItems.length > 0 && (
              <DayTimeline view={view} now={isToday ? now : undefined} onOpen={(it) => setEditing(it)} onChange={moveOnCalendar} />
            )}
            {mode === 'list' && (
            <div className="items">
              {dayItems.map((it, i) => (
                <div key={it.id}>
                  <ItemRow
                    item={it}
                    zoneNote={journeyNote(it, { trip, days })}
                    onClick={() => setEditing(it)}
                    actions={
                      <>
                        <button className="icon-btn" title="Done" onClick={() => setStatus(it, 'done')}>
                          {it.status === 'done' ? '✅' : '⬜'}
                        </button>
                        <DayItemMenu
                          first={i === 0}
                          last={i === dayItems.length - 1}
                          skipped={it.status === 'skipped'}
                          onUp={() => move(it, -1)}
                          onDown={() => move(it, 1)}
                          onSkip={() => setStatus(it, 'skipped')}
                          onTomorrow={() => postpone(it)}
                          navigateTo={it.location ?? it.to}
                        />
                      </>
                    }
                  />
                  {it.walk && it.walk.stops.length > 0 && (
                    <div style={{ margin: '0 0 10px 56px' }} className="stack">
                      <LazyMap
                        className="short"
                        markers={it.walk.stops.map((s, n) => ({ id: s.id, lat: s.lat, lon: s.lon, label: String(n + 1), variant: 'on', title: s.name }))}
                        line={it.walk.geometry}
                        dashed={it.walk.routedBy === 'straight-line'}
                        fitKey={it.id}
                      />
                      <Link className="btn btn-sm" to={`../walk?item=${it.id}`}>
                        Open walk
                      </Link>
                    </div>
                  )}
                </div>
              ))}
            </div>
            )}
          </div>
        </div>

        <div className="stack">
          {tonight && (
            <div className="card stack" style={{ gap: 6 }}>
              <h3>🛏️ Tonight</h3>
              <div className="strong">{tonight.title}</div>
              <div className="small muted">{itemSubtitle(tonight)}</div>
              {tonight.location?.lat != null && (
                <a className="btn btn-sm" href={directionsUrl(tonight.location.lat, tonight.location.lon!, 'transit')} target="_blank" rel="noreferrer">
                  Directions
                </a>
              )}
              {tonight.status !== 'booked' && <span className="badge danger">Not booked yet</span>}
            </div>
          )}
        </div>
      </div>

      {editing && <ItemEditor trip={trip} item={editing} city={day?.city} area={day} onClose={() => setEditing(null)} />}
      {replan && <ReplanModal date={date} dayItems={dayItems} onClose={() => setReplan(false)} />}
    </div>
  )
}

function directionsUrl(lat: number, lon: number, mode: 'walking' | 'transit') {
  // A plain link to Google Maps (no API, no key) — opens the Maps app on phones.
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=${mode}`
}

function DayItemMenu(p: {
  first: boolean
  last: boolean
  skipped: boolean
  onUp: () => void
  onDown: () => void
  onSkip: () => void
  onTomorrow: () => void
  navigateTo?: { lat?: number; lon?: number }
}) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-label="More">
        ⋯
      </button>
      {open && (
        <div className="card tight stack" style={{ position: 'absolute', right: 0, top: 34, zIndex: 10, gap: 2, minWidth: 180 }} onClick={() => setOpen(false)}>
          {!p.first && (
            <button className="btn-ghost btn-sm" style={{ justifyContent: 'flex-start' }} onClick={p.onUp}>
              ↑ Do earlier
            </button>
          )}
          {!p.last && (
            <button className="btn-ghost btn-sm" style={{ justifyContent: 'flex-start' }} onClick={p.onDown}>
              ↓ Do later
            </button>
          )}
          <button className="btn-ghost btn-sm" style={{ justifyContent: 'flex-start' }} onClick={p.onTomorrow}>
            → Move to next day
          </button>
          <button className="btn-ghost btn-sm" style={{ justifyContent: 'flex-start' }} onClick={p.onSkip}>
            {p.skipped ? '↺ Un-skip' : '⤼ Skip'}
          </button>
          {p.navigateTo?.lat != null && (
            <a className="btn btn-ghost btn-sm" style={{ justifyContent: 'flex-start' }} href={directionsUrl(p.navigateTo.lat, p.navigateTo.lon!, 'walking')} target="_blank" rel="noreferrer">
              🧭 Directions
            </a>
          )}
        </div>
      )}
    </div>
  )
}

function Countdown({ to, now }: { to: string; now: Date }) {
  const mins = hhmmToMin(to) - (now.getHours() * 60 + now.getMinutes())
  if (mins < 0) return null
  return (
    <div className="right">
      <div className="countdown">{mins >= 60 ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}` : `${mins}m`}</div>
      <div className="tiny muted">to go</div>
    </div>
  )
}

function Weather({ lat, lon, date }: { lat?: number; lon?: number; date: string }) {
  const { data } = useAsync(() => (lat != null && lon != null ? forecast({ lat, lon }) : Promise.resolve(undefined)), [lat, lon])
  const w = data?.find((d) => d.date === date)
  if (!w) return null
  const e = weatherEmoji(w.code)
  return (
    <div className="right" title={e.label}>
      <div style={{ fontSize: '1.8rem', lineHeight: 1 }}>{e.emoji}</div>
      <div className="small">
        {Math.round(w.tMax)}° / {Math.round(w.tMin)}°
      </div>
      {w.rainChance != null && w.rainChance > 20 && <div className="tiny muted">☔ {w.rainChance}%</div>}
    </div>
  )
}

const REASONS = ['It’s raining', 'The kids are tired', 'We’re running late', 'A place is closed', 'We want something more relaxed', 'We have extra time']

function ReplanModal({ date, dayItems, onClose }: { date: string; dayItems: Item[]; onClose: () => void }) {
  const { trip, days, settings } = useTripCtx()
  const day = days.find((d) => d.date === date) ?? { id: '', tripId: trip.id, date }
  const [reason, setReason] = useState(REASONS[0])
  const [from, setFrom] = useState(date === today() ? nowHHMM() : '09:00')
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState<string>()
  const prompt = replanPrompt(trip, settings, day, dayItems, reason, from)
  const keep = dayItems.filter((i) => i.status === 'done' || i.status === 'booked' || (i.startTime && i.startTime < from))

  async function apply() {
    try {
      const items = parseDayItems(answer)
      await applyDayReplan(trip, date, keep, items, settings.homeCurrency)
      toast(`Day updated with ${items.length} items`)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Modal title="✨ Replan the day" onClose={onClose}>
      <div className="stack">
        <label>What changed?</label>
        <div className="chips">
          {REASONS.map((r) => (
            <button key={r} className={`chip ${reason === r ? 'on' : ''}`} onClick={() => setReason(r)}>
              {r}
            </button>
          ))}
        </div>
        <div className="form-grid">
          <label className="full">
            Or in your own words
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <label>
            Replan from
            <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
        </div>
        <div className="row wrap">
          <button className="btn-primary" onClick={() => copyText(prompt)}>
            1 · Copy the prompt
          </button>
          {CHATBOTS.map((c) => (
            <a key={c.name} className="btn btn-sm" href={c.url} target="_blank" rel="noreferrer">
              Open {c.name} ↗
            </a>
          ))}
        </div>
        <details>
          <summary className="small muted">See the prompt</summary>
          <pre className="prompt">{prompt}</pre>
        </details>
        <label>
          2 · Paste the answer here
          <textarea className="code" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder='{"items": [ ... ]}' />
        </label>
        {error && <div className="notice error">{error}</div>}
        <p className="tiny muted">
          Keeps {keep.length} item(s) that are done, booked or before {from}; the rest of the day is replaced.
        </p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!answer.trim()} onClick={apply}>
            Update the day
          </button>
        </div>
      </div>
    </Modal>
  )
}
