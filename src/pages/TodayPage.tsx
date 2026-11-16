import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { adoptPlannerItems, db, touchTrip } from '../db'
import type { Item } from '../types'
import { addDays, dateRange, daysBetween, formatDate, formatDuration, hhmmToMin, nowHHMM, today } from '../lib/dates'
import { forecast, weatherEmoji } from '../lib/apis'
import { useAsync, useNow } from '../lib/hooks'
import { sortItems } from '../lib/hooks'
import { applyDayReplan, parseDayItems, replanPrompt } from '../lib/ai'
import { ItemRow, itemSubtitle } from '../components/ItemRow'
import { ItemEditor } from '../components/ItemEditor'
import { DayProportions, DayTimeline } from '../components/DayTimeline'
import { buildDayView, journeyNote } from '../lib/dayview'
import { tzCity } from '../lib/tz'
import { durationMin } from '../lib/tz'
import { fillUntimed, retimeAfter, untimedItems } from '../lib/favorites'
import { planRipple } from '../lib/ripple'
import { KIND_META, isTransport, needsBooking } from '../components/kinds'
import { Empty, Modal, Section, toast } from '../components/ui'
import { DayRouteMap } from '../components/DayRouteMap'
import { OptimiseDayButton } from '../components/OptimiseDay'
import { useDayRoute } from '../lib/dayroute'
import LazyMap from '../components/LazyMap'
import { BackupIdeas } from '../components/BackupIdeas'
import { tripPhase, useTripCtx } from './TripLayout'
import { AnswerBox, PromptBox } from './IdeasPage'
import { saveLocal } from '../lib/storage'
import { StayEditor } from '../components/StaysCard'
import { t, tn } from '../i18n'

export default function TodayPage() {
  const { trip, items, days, settings } = useTripCtx()
  const [params, setParams] = useSearchParams()
  const realToday = today()
  const ph = tripPhase(trip)
  const date = params.get('date') ?? (ph.phase === 'during' ? realToday : ph.phase === 'before' ? trip.startDate : trip.endDate)
  const isToday = date === realToday
  const now = useNow()
  const nowStr = nowHHMM()
  const day = days.find((d) => d.date === date)
  const dayItems = useMemo(() => sortItems(items.filter((i) => i.date === date)), [items, date])
  const untimed = untimedItems(items, date)
  // The day's path: every item with a place, numbered in time order. The numbers in the list match the ones on the map.
  const { route, loading: routeLoading, stops: routeStops } = useDayRoute(items, date, day, settings, { trip, days })
  const stopNo = new Map(routeStops.map((i, n) => [i.id, n + 1]))
  const [mapOpen, setMapOpen] = useState(() => localStorage.getItem('tm-day-map') !== '0')
  const mapBox = useRef<HTMLDivElement>(null)
  const showMap = () => {
    setMapOpen(true)
    setTimeout(() => mapBox.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80)
  }
  // The calendar in this day's own time (a flight from another zone is converted; one landing today shows its landing part).
  // On a day that changes time zone, the calendar can be shown in either zone (it starts in the one you set off from).
  const [zonePick, setZonePick] = useState<{ date: string; tz: string } | undefined>()
  const showIn = zonePick?.date === date ? zonePick.tz : undefined
  const view = useMemo(() => buildDayView(items, date, { trip, days }, showIn), [items, date, trip, days, showIn])
  const [mode, setViewState] = useState<'timeline' | 'list'>(() => (localStorage.getItem('tm-day-view') === 'list' ? 'list' : 'timeline'))
  const setMode = (v: 'timeline' | 'list') => {
    setViewState(v)
    saveLocal('tm-day-view', v)
  }
  const [editing, setEditing] = useState<(Partial<Item> & { date: string }) | null>(null)
  // Opened from elsewhere (the Budget's plan lines) to show one item: open it, then forget the link so it doesn't reopen.
  const itemParam = params.get('item')
  useEffect(() => {
    if (!itemParam) return
    const it = items.find((i) => i.id === itemParam)
    if (it) setEditing(it)
    setParams(date === realToday ? {} : { date }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemParam])
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
    const next = it.status === status ? 'planned' : status
    await db.items.update(it.id, { status: next })
    await adoptPlannerItems([it.id]) // ticked off or skipped: the City planner keeps it
    await touchTrip(trip.id)
    if (next !== 'done' && next !== 'skipped') return
    // The places still to come move up to fill the gap (or later, if you finished late), from where you are now.
    const r = await retimeAfter({ ...it, status: next }, settings, it.date === today() ? hhmmToMin(nowHHMM()) : undefined)
    if (r) {
      const by = formatDuration(Math.abs(r.shiftMin) * 60)
      const msg = !r.shiftMin
        ? tn(r.moved, '{n} later item moved later', '{n} later items moved later')
        : r.shiftMin < 0
          ? tn(r.moved, '{n} later item moved earlier by {by}', '{n} later items moved earlier by {by}', { by })
          : tn(r.moved, '{n} later item moved later by {by}', '{n} later items moved later by {by}', { by })
      toast(msg, { label: t('Undo'), run: r.undo })
    }
  }

  async function move(it: Item, dir: -1 | 1) {
    const idx = dayItems.indexOf(it)
    const other = dayItems[idx + dir]
    if (!other) return
    // Swap positions; if both are timed, swap times too so "do this first" just works.
    await db.items.bulkUpdate([
      { key: it.id, changes: { order: other.order, startTime: other.startTime && it.startTime ? other.startTime : it.startTime, autoTime: undefined, locked: true } },
      { key: other.id, changes: { order: it.order, startTime: other.startTime && it.startTime ? it.startTime : other.startTime, autoTime: undefined, locked: true } },
    ])
    await adoptPlannerItems([it.id, other.id])
  }

  async function postpone(it: Item) {
    const tomorrow = addDays(it.date, 1)
    if (tomorrow > trip.endDate) return toast(t('That’s the last day of the trip'))
    await db.items.update(it.id, { date: tomorrow, startTime: undefined, autoTime: undefined, locked: undefined })
    await adoptPlannerItems([it.id])
    toast(t('Moved to {date}', { date: formatDate(tomorrow) }))
  }

  /** Dragged on the calendar: save the new times, and offer to undo or to push overlapping items back. */
  /** Dragged on the calendar: save the new times. If it now overlaps what follows, offer to push those back. */
  async function moveOnCalendar(it: Item, times: { startTime: string; endTime?: string }) {
    const before = { startTime: it.startTime, endTime: it.endTime }
    // Placed by hand: 📌 locked at that time, so planning and optimising leave it there (unlock it from its ⋯ menu).
    await db.items.update(it.id, { startTime: times.startTime, endTime: times.endTime ?? it.endTime, autoTime: undefined, locked: true })
    await adoptPlannerItems([it.id])
    await touchTrip(trip.id)
    const ripple = planRipple(await db.items.where({ tripId: trip.id, date: it.date }).toArray(), { id: it.id, startTime: times.startTime, endTime: times.endTime }, before)
    if (ripple.moves.length && !ripple.blockedBy) {
      toast(tn(ripple.moves.length, '{title} now overlaps {n} item', '{title} now overlaps {n} items', { title: it.title }), {
        label: t('Push them back'),
        run: async () => {
          await db.items.bulkUpdate(ripple.moves.map((m) => ({ key: m.item.id, changes: { startTime: m.start, endTime: m.end, autoTime: undefined } })))
          await adoptPlannerItems(ripple.moves.map((m) => m.item.id))
          await touchTrip(trip.id)
        },
      })
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
            ? tn(ph.daysToGo, 'Your trip starts in {n} day. This is a preview of how each day will look while you travel.', 'Your trip starts in {n} days. This is a preview of how each day will look while you travel.')
            : t('This trip is over — here is how each day looked.')}
        </div>
      )}

      <div className="weather-strip day-strip" ref={chipsRef}>
        {dates.map((d, i) => (
          <button key={d} className={`chip ${d === date ? 'on' : ''}`} onClick={() => goto(d)} style={{ flex: 'none' }}>
            {d === realToday ? t('Today') : t('Day {n}', { n: i + 1 })} · {formatDate(d, { weekday: 'short', day: 'numeric' })}
          </button>
        ))}
      </div>

      <div className="grid-2 wide-left">
        <div className="stack">
          <div className="card hero stack">
            <div className="row between">
              <div>
                <div className="small muted">
                  {t('Day {n} of {total} · {date}', { n: dayNo, total: dates.length, date: formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' }) })}
                </div>
                <h2 style={{ fontSize: '1.4rem', marginTop: 2 }}>{[day?.city, day?.title].filter(Boolean).join(' — ') || t('Your day')}</h2>
              </div>
              <Weather lat={day?.lat} lon={day?.lon} date={date} />
            </div>
            {next ? (
              <div className="next-up">
                <div className="big-icon">{KIND_META[next.kind].emoji}</div>
                <div className="grow">
                  <div className="small muted">{current ? t('Now · until {time}', { time: current.endTime ?? '' }) : isToday ? t('Next up') : t('First up')}</div>
                  <div className="strong" style={{ fontSize: '1.1rem' }}>
                    {next.startTime && `${next.startTime} · `}
                    {next.title}
                  </div>
                  {itemSubtitle(next) && <div className="small muted">{itemSubtitle(next)}</div>}
                </div>
                {isToday && !current && next.startTime && <Countdown to={next.startTime} now={now} />}
              </div>
            ) : (
              <p className="muted">{dayItems.length ? t('All done for today 🎉') : t('Nothing planned — a free day.')}</p>
            )}
            <div className="row wrap">
              <button onClick={() => setEditing({ date })}>{t('+ Add')}</button>
              <Link className="btn" to={`../favorites${day?.city ? `?city=${encodeURIComponent(day.city)}` : ''}`}>
                {t('🗺️ City planner')}
              </Link>
              <button onClick={() => setReplan(true)}>{t('✨ Replan')}</button>
            </div>
          </div>

          {day && <BackupIdeas tripId={trip.id} day={day} />}

          {transports.length > 0 && (
            <div className="card stack" style={{ gap: 8 }}>
              <h3>{t('🧭 Travel today')}</h3>
              {transports.map((tr) => (
                <div key={tr.id} className="row-top">
                  <span style={{ fontSize: '1.4rem' }}>{KIND_META[tr.kind].emoji}</span>
                  <div className="grow">
                    <div className="strong">
                      {tr.startTime}
                      {tr.endTime && `–${tr.endTime}`} {tr.title}
                    </div>
                    <div className="small muted">
                      {tr.from?.name} → {tr.to?.name}
                      {tr.startTime && tr.endTime && ` · ${formatDuration((durationMin(tr, { trip, days }) ?? 0) * 60)}`}
                      {journeyNote(tr, { trip, days }) && ` · 🌏 ${journeyNote(tr, { trip, days })}`}
                    </div>
                    {tr.bookingRef && (
                      <div className="small">
                        {t('Booking ref')} <b style={{ fontFamily: 'ui-monospace, monospace', letterSpacing: '0.05em' }}>{tr.bookingRef}</b>
                      </div>
                    )}
                  </div>
                  {(tr.status === 'booked' || tr.status === 'done' || needsBooking(tr.kind)) && (
                    <span className={`badge ${tr.status}`}>{tr.status === 'booked' ? t('Booked') : tr.status === 'done' ? t('Done') : t('Not booked')}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="card">
            <div className="card-title">
              <h3>{t('Plan for the day')}</h3>
              <div className="row wrap" style={{ gap: 8 }}>
                <span className="small muted nowrap">
                  {t('{done}/{total} done', { done: dayItems.filter((i) => i.status === 'done').length, total: dayItems.length })}
                </span>
                {dayItems.length > 1 && <OptimiseDayButton tripId={trip.id} date={date} settings={settings} />}
                {dayItems.length > 0 && (
                  <div className="chips" style={{ flexWrap: 'nowrap' }}>
                    <button className={`chip ${mode === 'timeline' ? 'on' : ''}`} onClick={() => setMode('timeline')}>
                      {t('🕒 Timeline')}
                    </button>
                    <button className={`chip ${mode === 'list' ? 'on' : ''}`} onClick={() => setMode('list')}>
                      {t('☰ List')}
                    </button>
                  </div>
                )}
              </div>
            </div>
            {dayItems.length === 0 && <Empty emoji="☕" title={t('Free day')}>{t('Add something, build a walk, or just wander.')}</Empty>}
            {untimed.length > 0 && (
              <div className="notice row wrap between" style={{ marginBottom: 10 }}>
                <span>
                  {tn(untimed.length, '⏱ {n} item has no time yet: {titles}', '⏱ {n} items have no time yet: {titles}', { titles: untimed.map((i) => i.title).slice(0, 3).join(', ') + (untimed.length > 3 ? '…' : '') })}
                </span>
                <button
                  className="btn-sm btn-primary"
                  onClick={async () => {
                    const n = await fillUntimed(trip.id, date, settings)
                    toast(n ? tn(n, '{n} item fitted into the day around what already has a time', '{n} items fitted into the day around what already has a time') : t('No room left that day: move something or give it a time by hand'))
                  }}
                >
                  {t('Fit them into the day')}
                </button>
              </div>
            )}
            {dayItems.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <DayProportions entries={view.entries} />
              </div>
            )}
            {mode === 'timeline' && dayItems.length > 0 && (
              <DayTimeline
                view={view}
                now={isToday ? now : undefined}
                onOpen={(it) => setEditing(it)}
                onChange={moveOnCalendar}
                onZone={(tz) => setZonePick({ date, tz })}
                onUnlock={async (it) => {
                  await db.items.update(it.id, { locked: undefined })
                  await touchTrip(trip.id)
                  toast(t('🔓 {title} can move again when you optimise or plan', { title: it.title }))
                }}
              />
            )}
            {mode === 'list' && (
            <div className="items">
              {dayItems.map((it, i) => (
                <div key={it.id}>
                  <ItemRow
                    item={it}
                    zoneNote={journeyNote(it, { trip, days }) ?? (() => {
                      const z = view.entries.find((e) => e.item.id === it.id)?.otherZone
                      return z ? t('{city} time', { city: tzCity(z) }) : undefined
                    })()}
                    pin={stopNo.get(it.id)}
                    onPin={showMap}
                    onClick={() => setEditing(it)}
                    actions={
                      <>
                        <button className="icon-btn" title={t('Done')} onClick={() => setStatus(it, 'done')}>
                          {it.status === 'done' ? '✅' : '⬜'}
                        </button>
                        <DayItemMenu
                          first={i === 0}
                          last={i === dayItems.length - 1}
                          skipped={it.status === 'skipped'}
                          onUp={() => move(it, -1)}
                          onDown={() => move(it, 1)}
                          onSkip={() => setStatus(it, 'skipped')}
                          locked={it.locked}
                          canLock={['activity', 'meal', 'walk', 'note'].includes(it.kind) && !!it.startTime}
                          onLock={async () => {
                            await db.items.update(it.id, { locked: it.locked ? undefined : true })
                            await touchTrip(trip.id)
                            toast(it.locked ? t('{title} can move again when you optimise', { title: it.title }) : t('📌 {title} stays at {time}', { title: it.title, time: it.startTime ?? '' }))
                          }}
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
                    </div>
                  )}
                </div>
              ))}
            </div>
            )}
          </div>

          {routeStops.length > 0 && (
            <div ref={mapBox}>
              <Section
                open={mapOpen}
                onToggle={() => {
                  saveLocal('tm-day-map', mapOpen ? '0' : '1')
                  setMapOpen(!mapOpen)
                }}
                title={t('🗺️ Day on the map')}
                summary={tn(routeStops.length, '· {n} place, numbered as in the list', '· {n} places, numbered as in the list')}
              >
                <DayRouteMap route={route} loading={routeLoading} onOpen={setEditing} initialSize={settings.mapSize} />
              </Section>
            </div>
          )}
        </div>

        <div className="stack">
          {tonight && (
            <div className="card stack" style={{ gap: 6 }}>
              <h3>{t('🛏️ Tonight')}</h3>
              <button type="button" className="btn-ghost" style={{ textAlign: 'left', padding: 0, minHeight: 0, border: 0 }} onClick={() => setEditing(tonight)} title={t('Edit the hotel: name, address, nights, booking')}>
                <div className="strong">
                  {tonight.title} <span className="small" style={{ color: 'var(--primary)' }}>✏️</span>
                </div>
                <div className="small muted">
                  {[itemSubtitle(tonight), tonight.location?.name && tonight.location.name !== tonight.title ? tonight.location.name : ''].filter(Boolean).join(' · ')}
                </div>
              </button>
              {tonight.location?.lat != null && (
                <a className="btn btn-sm" href={directionsUrl(tonight.location.lat, tonight.location.lon!, 'transit')} target="_blank" rel="noreferrer">
                  {t('Directions')}
                </a>
              )}
              {tonight.status !== 'booked' && <span className="badge danger">{t('Not booked yet')}</span>}
            </div>
          )}
        </div>
      </div>

      {/* A hotel opens the same editor as in "Where you sleep" on the Plan tab: name, address, nights, booking. */}
      {editing?.kind === 'stay' && editing.id ? (
        <StayEditor stay={editing as Item} city={days.find((d) => d.date === editing.date)?.city ?? day?.city ?? ''} currency={settings.homeCurrency} onClose={() => setEditing(null)} />
      ) : (
        editing && <ItemEditor trip={trip} item={editing} city={day?.city} area={day} onClose={() => setEditing(null)} />
      )}
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
  locked?: boolean
  canLock?: boolean
  onLock?: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-label={t('More')}>
        ⋯
      </button>
      {open && (
        <div className="card tight stack" style={{ position: 'absolute', right: 0, top: 34, zIndex: 10, gap: 2, minWidth: 180 }} onClick={() => setOpen(false)}>
          {!p.first && (
            <button className="btn-ghost btn-sm" style={{ justifyContent: 'flex-start' }} onClick={p.onUp}>
              {t('↑ Do earlier')}
            </button>
          )}
          {!p.last && (
            <button className="btn-ghost btn-sm" style={{ justifyContent: 'flex-start' }} onClick={p.onDown}>
              {t('↓ Do later')}
            </button>
          )}
          <button className="btn-ghost btn-sm" style={{ justifyContent: 'flex-start' }} onClick={p.onTomorrow}>
            {t('→ Move to next day')}
          </button>
          <button className="btn-ghost btn-sm" style={{ justifyContent: 'flex-start' }} onClick={p.onSkip}>
            {p.skipped ? t('↺ Un-skip') : t('⤼ Skip')}
          </button>
          {p.canLock && (
            <button className="btn-ghost btn-sm" style={{ justifyContent: 'flex-start' }} onClick={p.onLock}>
              {p.locked ? t('🔓 Let it move') : t('📌 Lock this time')}
            </button>
          )}
          {p.navigateTo?.lat != null && (
            <a className="btn btn-ghost btn-sm" style={{ justifyContent: 'flex-start' }} href={directionsUrl(p.navigateTo.lat, p.navigateTo.lon!, 'walking')} target="_blank" rel="noreferrer">
              {t('🧭 Directions')}
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
      <div className="countdown">{mins >= 60 ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}` : t('{n}m', { n: mins })}</div>
      <div className="tiny muted">{t('to go')}</div>
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

const REASONS = [t('It’s raining'), t('The kids are tired'), t('We’re running late'), t('A place is closed'), t('We want something more relaxed'), t('We have extra time')]

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
      toast(tn(items.length, 'Day updated with {n} item', 'Day updated with {n} items'))
      onClose()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Modal title={t('✨ Replan the day')} onClose={onClose}>
      <div className="stack">
        <label>{t('What changed?')}</label>
        <div className="chips">
          {REASONS.map((r) => (
            <button key={r} className={`chip ${reason === r ? 'on' : ''}`} onClick={() => setReason(r)}>
              {r}
            </button>
          ))}
        </div>
        <div className="form-grid">
          <label className="full">
            {t('Or in your own words')}
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <label>
            {t('Replan from')}
            <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
        </div>
        <PromptBox prompt={prompt} onAnswer={setAnswer} />
        <AnswerBox label={t('2 · Paste the answer here')} value={answer} onChange={setAnswer} placeholder='{"items": [ ... ]}' />
        {error && <div className="notice error">{error}</div>}
        <p className="tiny muted">
          {tn(keep.length, 'Keeps {n} item that is done, booked or before {from}; the rest of the day is replaced.', 'Keeps {n} items that are done, booked or before {from}; the rest of the day is replaced.', { from })}
        </p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={onClose}>{t('Cancel')}</button>
          <button className="btn-primary" disabled={!answer.trim()} onClick={apply}>
            {t('Update the day')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
