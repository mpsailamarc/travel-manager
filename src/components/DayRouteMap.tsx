import { useMemo } from 'react'
import type { Item } from '../types'
import type { DayRoute } from '../lib/dayroute'
import { legText } from '../lib/legs'
import { distance } from '../lib/format'
import LazyMap, { type MapMarker } from './LazyMap'

/** The day's path on a map: numbered stops in time order joined by the way you get between them, and the same list underneath. */
export function DayRouteMap({ route, loading, onOpen, className = 'short' }: { route?: DayRoute; loading: boolean; onOpen: (it: Item) => void; className?: string }) {
  const markers = useMemo((): MapMarker[] => {
    if (!route) return []
    const m: MapMarker[] = route.stops.map((s, n) => ({ id: s.item.id, lat: s.at.lat, lon: s.at.lon, label: String(n + 1), variant: 'on', title: s.item.title, onClick: () => onOpen(s.item) }))
    if (route.start) m.push({ id: 'start', lat: route.start.lat, lon: route.start.lon, label: 'S', variant: 'start', title: route.start.name ?? 'Start' })
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route])

  if (!route?.stops.length) return <p className="small muted">{loading ? 'Working out the route…' : 'Nothing with a place on this day yet. Add a place to an activity (Edit, then “Find”) and it shows here.'}</p>
  return (
    <div className="stack" style={{ gap: 8 }}>
      <LazyMap className={className} markers={markers} segments={route.segments} fitKey={route.stops.map((s) => s.item.id + s.item.startTime).join()} locate />
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
      </ol>
    </div>
  )
}
