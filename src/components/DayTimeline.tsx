import type { Item, ItemKind } from '../types'
import { KIND_META } from './kinds'
import { formatDuration, hhmmToMin, minToHHMM } from '../lib/dates'

const PX_PER_HOUR = 52
const GUTTER = 46 // room for the hour labels

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
  item: Item
  start: number
  end: number
  estimated: boolean
  col: number
  cols: number
}

function layout(items: Item[]): { blocks: Block[]; untimed: Item[] } {
  const untimed = items.filter((i) => !i.startTime)
  const raw = items
    .filter((i) => i.startTime)
    .map((item) => {
      const start = hhmmToMin(item.startTime!)
      let end = item.endTime ? hhmmToMin(item.endTime) : start
      const estimated = !item.endTime || end === start
      if (estimated) end = start + guessMinutes(item)
      else if (end < start) end = 24 * 60 // runs past midnight: show to the end of the day
      return { item, start, end: Math.min(end, 24 * 60), estimated }
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
  return { blocks, untimed }
}

/** How the day divides between travel, activities and meals: one bar, so proportions are obvious at a glance. */
export function DayProportions({ items }: { items: Item[] }) {
  const { blocks } = layout(items)
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

/** The day laid out on an hour scale: a block is as tall as the activity is long. Tap one to open it. */
export function DayTimeline({ items, now, onOpen }: { items: Item[]; now?: Date; onOpen: (item: Item) => void }) {
  const { blocks, untimed } = layout(items)
  if (!blocks.length) {
    return <p className="small muted">Give items a start time (and an end time) to see the day laid out here.{untimed.length ? ` ${untimed.length} item(s) have no time yet.` : ''}</p>
  }
  const from = Math.max(0, Math.floor(Math.min(...blocks.map((b) => b.start), 7 * 60) / 60) * 60)
  const to = Math.min(24 * 60, Math.ceil(Math.max(...blocks.map((b) => b.end), 19 * 60) / 60) * 60)
  const y = (min: number) => ((min - from) / 60) * PX_PER_HOUR
  const nowMin = now ? now.getHours() * 60 + now.getMinutes() : undefined
  const hours: number[] = []
  for (let m = from; m <= to; m += 60) hours.push(m)

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="tl" style={{ height: y(to) }}>
        {hours.map((m) => (
          <div key={m} className="tl-hour" style={{ top: y(m) }}>
            <span>{minToHHMM(m % (24 * 60))}</span>
          </div>
        ))}
        {blocks.map((b) => {
          const meta = KIND_META[b.item.kind]
          const height = Math.max(26, y(b.end) - y(b.start) - 2)
          const tall = height >= 44
          return (
            <button
              key={b.item.id}
              className={`tl-block ${meta.cls || b.item.kind} ${b.item.status === 'done' ? 'is-done' : ''} ${b.estimated ? 'is-estimated' : ''}`}
              style={{
                top: y(b.start),
                height,
                left: `calc(${GUTTER}px + (100% - ${GUTTER}px) * ${b.col / b.cols})`,
                width: `calc((100% - ${GUTTER}px) / ${b.cols} - 3px)`,
              }}
              onClick={() => onOpen(b.item)}
              title={`${b.item.title} · ${b.item.startTime}–${minToHHMM(b.end % (24 * 60))}${b.estimated ? ' (estimated length)' : ''}`}
            >
              <b>
                {meta.emoji} {b.item.title}
              </b>
              {tall && (
                <span>
                  {b.item.startTime}–{minToHHMM(b.end % (24 * 60))} · {b.estimated ? '~' : ''}
                  {formatDuration((b.end - b.start) * 60)}
                </span>
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
      {blocks.some((b) => b.estimated) && <p className="tiny muted">Dashed blocks have no end time: their length is a guess (~). Set an end time to make it exact.</p>}
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
