import { useEffect, useRef, useState } from 'react'
import type { Item, ItemKind } from '../types'
import { KIND_META } from './kinds'
import { formatDuration, minToHHMM } from '../lib/dates'
import { tzLabel } from '../lib/tz'
import type { DayEntry, DayView } from '../lib/dayview'

const PX_PER_HOUR = 52
const GUTTER = 46 // room for the hour labels
const SNAP = 15 // minutes
const MIN_LEN = 15
const HOLD_MS = 550 // touch: hold this long before a block (or its edge) can be dragged, so a swipe over it is just a scroll

type Group = 'travel' | 'activities' | 'meals' | 'stay' | 'other'

export const GROUPS: Record<Group, { label: string; emoji: string; color: string }> = {
  travel: { label: 'Travel', emoji: '🧭', color: '#60a5fa' },
  activities: { label: 'Activities', emoji: '🎟️', color: '#2dd4bf' },
  meals: { label: 'Meals', emoji: '🍽️', color: '#fb923c' },
  stay: { label: 'Check-in', emoji: '🛏️', color: '#c084fc' },
  other: { label: 'Other', emoji: '📝', color: '#a8a29e' },
}

function groupOf(kind: ItemKind): Group {
  if (KIND_META[kind].cls === 'transport') return 'travel'
  if (kind === 'activity' || kind === 'walk') return 'activities'
  if (kind === 'meal') return 'meals'
  if (kind === 'stay') return 'stay'
  return 'other'
}

/** What an item without an end time probably takes, so it still gets a sensible block. */
function guessMinutes(it: Item): number {
  if (it.walk) return Math.round(it.walk.walkS / 60 + it.walk.stops.reduce((s, x) => s + x.visitMin, 0))
  switch (it.kind) {
    case 'meal':
      return 60
    case 'activity':
    case 'walk':
      return 90
    case 'flight':
    case 'train':
    case 'ferry':
    case 'drive':
      return 120
    case 'bus':
      return 45
    case 'car':
    case 'taxi':
    case 'stay':
      return 30
    case 'note':
      return 15
    default:
      return 60
  }
}

interface Block {
  entry: DayEntry
  item: Item
  start: number
  end: number
  estimated: boolean
  col: number
  cols: number
  /** Booked, converted from another zone, or cut by midnight: edit it in the form, not by dragging. */
  fixed: boolean
}

function layout(entries: DayEntry[]): Block[] {
  const raw = entries
    .map((e) => {
      const estimated = e.end == null
      const end = Math.max(e.end ?? e.start + guessMinutes(e.item), e.start + MIN_LEN)
      const fixed = e.item.status === 'booked' || !!e.item.bookingRef || !!e.converted || !!e.spill || !!e.clippedStart || !!e.clippedEnd
      return { entry: e, item: e.item, start: e.start, end: Math.min(end, 24 * 60), estimated, fixed }
    })
    .sort((a, b) => a.start - b.start || a.end - b.end)

  // Items that overlap share the width: each cluster of overlapping items gets as many columns as it needs.
  const blocks: Block[] = []
  let cluster: Block[] = []
  let clusterEnd = -1
  let colEnds: number[] = []
  const flush = () => {
    cluster.forEach((b) => (b.cols = colEnds.length))
    blocks.push(...cluster)
    cluster = []
    colEnds = []
  }
  for (const r of raw) {
    if (cluster.length && r.start >= clusterEnd) flush()
    let col = colEnds.findIndex((e) => e <= r.start)
    if (col < 0) col = colEnds.length
    colEnds[col] = r.end
    cluster.push({ ...r, col, cols: 1 })
    clusterEnd = Math.max(clusterEnd, r.end)
  }
  flush()
  return blocks
}

/** How the day divides between travel, activities and meals: one bar, so proportions are obvious at a glance. */
export function DayProportions({ entries }: { entries: DayEntry[] }) {
  const blocks = layout(entries)
  const totals = new Map<Group, number>()
  for (const b of blocks) {
    const g = groupOf(b.item.kind)
    if (g === 'stay' || b.item.status === 'skipped') continue // a check-in isn't time spent
    totals.set(g, (totals.get(g) ?? 0) + (b.end - b.start))
  }
  const sum = [...totals.values()].reduce((a, b) => a + b, 0)
  if (!sum) return null
  const rows = (Object.keys(GROUPS) as Group[]).filter((g) => totals.get(g))
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="prop-bar" role="img" aria-label={rows.map((g) => `${GROUPS[g].label} ${formatDuration(totals.get(g)! * 60)}`).join(', ')}>
        {rows.map((g) => (
          <div key={g} style={{ width: `${(totals.get(g)! / sum) * 100}%`, background: GROUPS[g].color }} title={`${GROUPS[g].label}: ${formatDuration(totals.get(g)! * 60)}`} />
        ))}
      </div>
      <div className="row wrap" style={{ gap: 12 }}>
        {rows.map((g) => (
          <span key={g} className="small row" style={{ gap: 5 }}>
            <i className="prop-dot" style={{ background: GROUPS[g].color }} />
            {GROUPS[g].label} <b>{formatDuration(totals.get(g)! * 60)}</b> <span className="muted">{Math.round((totals.get(g)! / sum) * 100)}%</span>
          </span>
        ))}
        <span className="small muted">· {formatDuration(sum * 60)} planned</span>
      </div>
    </div>
  )
}

type Mode = 'move' | 'start' | 'end'
interface Live {
  id: string
  mode: Mode
  start: number
  end: number
}
interface Gesture {
  block: Block
  mode: Mode
  x0: number
  y0: number
  touch: boolean
  active: boolean
  timer?: number
  live: { start: number; end: number }
  activate: () => void
}

const hhmm = (min: number) => minToHHMM(Math.min(min, 24 * 60 - 1))

/**
 * The day laid out on an hour scale, in the day's destination time: a block is as tall as the activity is long.
 * Tap a block to open it. Hold it (touch) or press and drag (mouse) to move it; drag its top or bottom edge to change
 * when it starts or how long it lasts. Times snap to 15 minutes.
 */
export function DayTimeline({
  view,
  now,
  onOpen,
  onChange,
  onUnlock,
}: {
  view: DayView
  now?: Date
  onOpen: (item: Item) => void
  onChange?: (item: Item, times: { startTime: string; endTime?: string }) => void
  onUnlock?: (item: Item) => void // tap the 📌 on a block to let it move again
}) {
  const blocks = layout(view.entries)
  const { untimed } = view
  const from = blocks.length ? Math.max(0, Math.floor(Math.min(...blocks.map((b) => b.start), 7 * 60) / 60) * 60) : 7 * 60
  const to = blocks.length ? Math.min(24 * 60, Math.ceil(Math.max(...blocks.map((b) => b.end), 19 * 60) / 60) * 60) : 19 * 60

  const [live, setLive] = useState<Live | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const suppressClick = useRef(false)
  const wrap = useRef<HTMLDivElement>(null)
  const latest = useRef({ from, to, onChange })
  latest.current = { from, to, onChange }

  // While a block is being dragged the page must not scroll under the finger.
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const stop = (e: TouchEvent) => {
      if (gesture.current?.active && e.cancelable) e.preventDefault()
    }
    el.addEventListener('touchmove', stop, { passive: false })
    return () => el.removeEventListener('touchmove', stop)
  }, [blocks.length])

  function clean() {
    const g = gesture.current
    if (g?.timer) clearTimeout(g.timer)
    gesture.current = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
  }

  function onMove(e: PointerEvent) {
    const g = gesture.current
    if (!g) return
    const dx = e.clientX - g.x0
    const dy = e.clientY - g.y0
    if (!g.active) {
      if (g.touch && (Math.abs(dy) > 8 || Math.abs(dx) > 8)) return clean() // the finger is scrolling the page
      if (!g.touch && g.mode === 'move' && Math.abs(dy) > 4) g.activate()
      if (!g.active) return
    }
    // Lands on the quarter hours of the clock (15:00, 15:15, 15:30…), whatever time it started from.
    const delta = (dy / PX_PER_HOUR) * 60
    const snap = (m: number) => Math.round(m / SNAP) * SNAP
    const { from, to } = latest.current
    const b = g.block
    let start = b.start
    let end = b.end
    if (g.mode === 'move') {
      const len = b.end - b.start
      start = Math.min(Math.max(snap(b.start + delta), from), to - len)
      end = start + len
    } else if (g.mode === 'end') {
      end = Math.min(Math.max(snap(b.end + delta), snap(b.start + MIN_LEN)), to)
    } else {
      start = Math.min(Math.max(snap(b.start + delta), from), b.end - MIN_LEN)
    }
    g.live = { start, end }
    setLive({ id: b.item.id, mode: g.mode, start, end })
  }

  function onUp() {
    const g = gesture.current
    const cb = latest.current.onChange
    if (g?.active) {
      suppressClick.current = true // the click that follows the release must not open the item
      setTimeout(() => (suppressClick.current = false), 150)
      const b = g.block
      const changed = g.live.start !== b.start || g.live.end !== b.end
      if (changed && cb) {
        // Only the part you changed is written: moving keeps the length, an item with no end time stays without one.
        const hasEnd = !!b.item.endTime || g.mode === 'end' || (g.mode === 'start' && !b.estimated)
        cb(b.item, { startTime: hhmm(g.live.start), endTime: hasEnd || g.mode !== 'move' ? hhmm(g.live.end) : undefined })
      }
    }
    setLive(null)
    clean()
  }

  function onCancel() {
    setLive(null)
    clean()
  }

  function down(e: React.PointerEvent, b: Block, mode: Mode) {
    if (!onChange || b.fixed) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (gesture.current) clean()
    const g: Gesture = {
      block: b,
      mode,
      x0: e.clientX,
      y0: e.clientY,
      touch: e.pointerType !== 'mouse',
      active: false,
      live: { start: b.start, end: b.end },
      activate: () => {
        g.active = true
        navigator.vibrate?.(12)
        setLive({ id: b.item.id, mode, start: b.start, end: b.end })
      },
    }
    gesture.current = g
    if (mode !== 'move') e.stopPropagation()
    if (g.touch) {
      // A finger has to hold still first, for moving and for changing the length alike: a swipe across the calendar only scrolls.
      g.timer = window.setTimeout(g.activate, HOLD_MS)
    } else if (mode !== 'move') {
      g.activate() // with a mouse, the edge handles start at once
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  if (!blocks.length) {
    return <p className="small muted">Give items a start time (and an end time) to see the day laid out here.{untimed.length ? ` ${untimed.length} item(s) have no time yet.` : ''}</p>
  }
  const y = (min: number) => ((min - from) / 60) * PX_PER_HOUR
  const nowMin = now ? now.getHours() * 60 + now.getMinutes() : undefined
  const hours: number[] = []
  for (let m = from; m <= to; m += 60) hours.push(m)
  const editable = !!onChange && blocks.some((b) => !b.fixed)

  return (
    <div className="stack" style={{ gap: 8 }}>
      {view.tz && (
        <p className="tiny muted" style={{ margin: 0 }}>
          🕒 Times in <b>{tzLabel(view.tz)}</b>, the local time of this day
        </p>
      )}
      <div className="tl" ref={wrap} style={{ height: y(to) }}>
        {hours.map((m) => (
          <div key={m} className="tl-hour" style={{ top: y(m) }}>
            <span>{minToHHMM(m % (24 * 60))}</span>
          </div>
        ))}
        {blocks.map((b) => {
          const meta = KIND_META[b.item.kind]
          const l = live?.id === b.item.id ? live : undefined
          const start = l?.start ?? b.start
          const end = l?.end ?? b.end
          const height = Math.max(26, y(end) - y(start) - 2)
          const tall = height >= 44
          const gripTop = !!onChange && !b.fixed && height >= 66 // short blocks only get the bottom handle: the top would cover their title
          const gripBottom = !!onChange && !b.fixed && height >= 46
          const note = b.entry.zoneNote
          return (
            <button
              key={b.item.id + (b.entry.spill ? ':spill' : '')}
              className={`tl-block ${meta.cls || b.item.kind} ${b.item.status === 'done' ? 'is-done' : ''} ${b.estimated && !l ? 'is-estimated' : ''} ${l ? 'is-dragging' : ''} ${b.fixed ? '' : 'is-editable'} ${gripTop ? 'has-top-grip' : ''} ${gripBottom ? 'has-bottom-grip' : ''}`}
              style={{
                top: y(start),
                height,
                left: `calc(${GUTTER}px + (100% - ${GUTTER}px) * ${b.col / b.cols})`,
                width: `calc((100% - ${GUTTER}px) / ${b.cols} - 3px)`,
              }}
              onPointerDown={(e) => down(e, b, 'move')}
              onContextMenu={(e) => gesture.current && e.preventDefault()}
              onClick={() => !suppressClick.current && onOpen(b.item)}
              title={`${b.item.title} · ${hhmm(start)}–${hhmm(end)}${b.estimated ? ' (estimated length)' : ''}${note ? ` · ${note}` : ''}`}
            >
              {gripTop && <i className="tl-grip top" onPointerDown={(e) => down(e, b, 'start')} onClick={(e) => e.stopPropagation()} aria-label="Drag to change the start" />}
              {b.item.locked && (
                <i
                  className="tl-pin"
                  role="button"
                  title={onUnlock ? 'Locked at this time: tap to let it move' : 'Locked at this time'}
                  aria-label="Unlock"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    onUnlock?.(b.item)
                  }}
                >
                  📌
                </i>
              )}
              <b>
                {meta.emoji} {b.item.title}
              </b>
              {tall && (
                <span>
                  {b.entry.spill ? `lands ${hhmm(end)}` : `${hhmm(start)}–${hhmm(end)}`} · {b.estimated && !l ? '~' : ''}
                  {formatDuration((end - start) * 60)}
                </span>
              )}
              {tall && note && <span>🌏 {note}</span>}
              {gripBottom && <i className="tl-grip bottom" onPointerDown={(e) => down(e, b, 'end')} onClick={(e) => e.stopPropagation()} aria-label="Drag to change the end" />}
              {l && (
                <em className="tl-tip">
                  {hhmm(start)}–{hhmm(end)} · {formatDuration((end - start) * 60)}
                </em>
              )}
            </button>
          )
        })}
        {nowMin != null && nowMin >= from && nowMin <= to && (
          <div className="tl-now" style={{ top: y(nowMin) }}>
            <span>now</span>
          </div>
        )}
      </div>
      {editable && (
        <p className="tiny muted">
          ✋ Press and hold a block, then drag it to move it (it snaps to the quarter hour); press and hold its top or bottom edge, then drag, to change when it starts or ends. What you place is 📌 locked there:
          tap the 📌 to let it move again. Booked items stay fixed.
        </p>
      )}
      {blocks.some((b) => b.estimated) && <p className="tiny muted">Dashed blocks have no end time: their length is a guess (~). Drag the bottom edge to set it.</p>}
      {untimed.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <b className="small">No time set</b>
          <div className="chips">
            {untimed.map((i) => (
              <button key={i.id} className="chip" onClick={() => onOpen(i)}>
                {KIND_META[i.kind].emoji} {i.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
