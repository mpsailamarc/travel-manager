import { useMemo } from 'react'
import type { Item } from '../types'
import type { DayRoute } from '../lib/dayroute'
import { legText, MODE_COLOR } from '../lib/legs'
import { distance } from '../lib/format'
import LazyMap, { type MapMarker } from './LazyMap'
import { useMapSize, type MapSize } from '../lib/hooks'

/** The day's path on a map: numbered stops in time order joined by the way you get between them, and the same list underneath. */
export function DayRouteMap({
  route,
  loading,
  onOpen,
  sizeKey = 'tm-day-route-map',
  initialSize,
}: {
  route?: DayRoute
  loading: boolean
  onOpen: (it: Item) => void
  sizeKey?: string
  initialSize?: MapSize // from Settings
}) {
  const [size, setSize] = useMapSize(sizeKey, initialSize)
  const markers = useMemo((): MapMarker[] => {
    if (!route) return []
    const m: MapMarker[] = route.stops.map((s, n) => ({
      id: s.item.id,
      lat: s.at.lat,
      lon: s.at.lon,
      label: String(n + 1),
      variant: 'on',
      title: s.item.title,
      onClick: () => onOpen(s.item),
    }))
    if (route.start)
      m.push({
        id: 'start',
        lat: route.start.lat,
        lon: route.start.lon,
        label: 'S',
        variant: 'start',
        title: route.start.name ?? 'Start',
      })
    // Tonight's hotel, when it isn't where the day started (a moving day).
    const e = route.end
    if (e && !(route.start && Math.abs(route.start.lat - e.lat) < 1e-3 && Math.abs(route.start.lon - e.lon) < 1e-3)) m.push({ id: 'end', lat: e.lat, lon: e.lon, label: '🏨', variant: 'start', title: `Tonight: ${e.name}` })
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route])

  if (!route?.stops.length) return <p className="small muted">{loading ? 'Working out the route…' : 'Nothing with a place on this day yet. Add a place to an activity (Edit, then “Find”) and it shows here.'}</p>
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="chips" style={{ justifyContent: 'flex-end' }}>
        {(['small', 'large', 'hidden'] as const).map((v) => (
          <button key={v} className={`chip ${size === v ? 'on' : ''}`} onClick={() => setSize(v)}>
            {v === 'small' ? 'Small' : v === 'large' ? 'Large' : 'Hide map'}
          </button>
        ))}
      </div>
      {size !== 'hidden' && (
        <LazyMap key={size} className={size === 'large' ? 'tall' : 'short'} markers={markers} segments={route.segments} fitKey={route.stops.map((s) => s.item.id + s.item.startTime).join()} locate />
      )}
      {/* The stops are the day's plan above, in the same order: the list adds the travel between them, so it starts folded. */}
      <details>
        <summary className="small muted" style={{ cursor: 'pointer' }}>
          🧭 Step by step · {route.stops.length} {route.stops.length === 1 ? 'stop' : 'stops'}, with the travel between them and the colour key
        </summary>
        <p className="tiny muted" style={{ margin: '6px 0' }}>
          <span style={{ color: MODE_COLOR.walk }}>━</span> walk · <span style={{ color: MODE_COLOR.transit }}>┅</span> public transport (approximate path) ·{' '}
          <span style={{ color: MODE_COLOR.taxi }}>━</span> taxi · <span style={{ color: MODE_COLOR.drive }}>━</span> your car
          {route.stops.some((s) => s.item.kind === 'flight') && (
            <>
              {' '}
              · <span style={{ color: MODE_COLOR.flight }}>┅</span> flight
            </>
          )}
        </p>
        <ol className="route-list">
          {route.stops.map((s, n) => (
            <li key={s.item.id}>
              <button type="button" className="route-stop" onClick={() => onOpen(s.item)}>
                <span className="pin">{n + 1}</span>
                <span className="grow" style={{ textAlign: 'left' }}>
                  <b className="small">
                    {s.item.startTime && `${s.item.startTime} · `}
                    {s.item.title}
                  </b>
                  {s.access && (
                    <span className="tiny muted" style={{ display: 'block' }}>
                      {legText(s.access, distance)} to the airport
                      {s.access.fromName ? ` from ${s.access.fromName}` : ''}
                    </span>
                  )}
                  {s.leg && (
                    <span className="tiny muted" style={{ display: 'block' }}>
                      {legText(s.leg, distance)}
                      {s.leg.fromName ? ` from ${s.leg.fromName}` : ''}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
          {route.end?.leg && (
            <li>
              <div className="route-stop">
                <span className="pin">🏨</span>
                <span className="grow" style={{ textAlign: 'left' }}>
                  <b className="small">Back to {route.end.name}</b>
                  <span className="tiny muted" style={{ display: 'block' }}>
                    {legText(route.end.leg, distance)}
                    {route.end.leg.fromName ? ` from ${route.end.leg.fromName}` : ''}
                  </span>
                </span>
              </div>
            </li>
          )}
        </ol>
      </details>
    </div>
  )
}
