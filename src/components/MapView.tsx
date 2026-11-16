import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { nearLon, unwrapPath, unwrapSegments } from '../lib/geo'
import { t } from '../i18n'

// MapLibre locates its worker relative to its own file, which breaks once bundled; point it at the emitted asset.
maplibregl.setWorkerUrl(workerUrl)

// OpenFreeMap: free vector tiles from OpenStreetMap data, no API key. Tiles you view are cached for offline use.
const STYLE = 'https://tiles.openfreemap.org/styles/liberty'

export interface MapMarker {
  id: string
  lat: number
  lon: number
  label?: string
  variant?: 'on' | 'start' | 'dim' | 'dot'
  title?: string
  onClick?: () => void
}

/** Where the map is looking: its centre, zoom, and the radius of a circle that covers what is on screen. */
export interface MapViewState {
  lat: number
  lon: number
  zoom: number
  radiusM: number
  user: boolean // moved by the person (drag, pinch, zoom buttons), not by the app fitting markers
}

interface Props {
  markers: MapMarker[]
  line?: [number, number][]
  dashed?: boolean
  /** Several pieces with their own style: road routes solid, flights and other straight legs dashed; a colour per way of travel. */
  segments?: { coords: [number, number][]; dashed: boolean; color?: string }[]
  className?: string
  /** Change this to re-fit the view to the markers. */
  fitKey?: string
  center?: { lat: number; lon: number }
  zoom?: number
  onMoveEnd?: (view: MapViewState) => void
  locate?: boolean
}

export default function MapView({ markers, line, dashed, segments, className = '', fitKey, center, zoom = 13, onMoveEnd, locate }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const markerRefs = useRef<maplibregl.Marker[]>([])
  const ready = useRef(false)
  const pendingLine = useRef<Props['line']>(undefined)
  const segRef = useRef(segments)
  segRef.current = segments
  const moveCb = useRef(onMoveEnd)
  moveCb.current = onMoveEnd

  useEffect(() => {
    if (!el.current) return
    const first = center ?? markers[0] ?? { lat: 48.8566, lon: 2.3522 }
    const m = new maplibregl.Map({
      container: el.current,
      style: STYLE,
      center: [first.lon, first.lat],
      zoom,
      attributionControl: { compact: true },
      locale: {
        'NavigationControl.ZoomIn': t('Zoom in'),
        'NavigationControl.ZoomOut': t('Zoom out'),
        'GeolocateControl.FindMyLocation': t('Find my location'),
        'GeolocateControl.LocationNotAvailable': t('Location not available'),
        'AttributionControl.ToggleAttribution': t('Toggle attribution'),
      },
    })
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    if (locate) m.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true }), 'top-right')
    // The map credits (OpenStreetMap…) start folded: just the ⓘ button, which opens them. MapLibre unfolds them once,
    // when the map's sources arrive; the first time it does, they are folded again (a tap on ⓘ still opens them).
    const credits = el.current.querySelector('.maplibregl-ctrl-attrib')
    let folded = false
    const watch = new MutationObserver(() => {
      if (!folded && credits?.classList.contains('maplibregl-compact-show')) {
        credits.classList.remove('maplibregl-compact-show')
        folded = true
        watch.disconnect()
      }
    })
    if (credits) watch.observe(credits, { attributes: true, attributeFilter: ['class'] })
    m.on('load', () => {
      ready.current = true
      m.addSource('route', { type: 'geojson', data: lineData(pendingLine.current ?? line) })
      m.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#0f766e', 'line-width': 5, 'line-opacity': 0.85, ...(dashed ? { 'line-dasharray': [1.5, 1.5] } : {}) },
      })
      for (const dash of [true, false]) {
        m.addSource(dash ? 'seg-dashed' : 'seg-solid', { type: 'geojson', data: segData(segRef.current, dash) })
        m.addLayer({
          id: dash ? 'seg-dashed' : 'seg-solid',
          type: 'line',
          source: dash ? 'seg-dashed' : 'seg-solid',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': ['get', 'color'], 'line-width': dash ? 4 : 5, 'line-opacity': 0.85, ...(dash ? { 'line-dasharray': [1.5, 1.5] } : {}) },
        })
      }
    })
    m.on('moveend', (e) => {
      const c = m.getCenter()
      moveCb.current?.({ lat: c.lat, lon: c.lng, zoom: m.getZoom(), radiusM: c.distanceTo(m.getBounds().getNorthEast()), user: !!(e as { originalEvent?: unknown }).originalEvent })
    })
    map.current = m
    return () => {
      watch.disconnect()
      m.remove()
      map.current = null
      ready.current = false
    }
    // Map is created once; props are synced by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Markers
  useEffect(() => {
    const m = map.current
    if (!m) return
    markerRefs.current.forEach((mk) => mk.remove())
    markerRefs.current = markers.map((mk) => {
      const div = document.createElement('div')
      div.className = `marker ${mk.variant ?? ''}`
      div.textContent = mk.label ?? ''
      if (mk.title) div.title = mk.title
      if (mk.onClick) {
        div.style.cursor = 'pointer'
        div.addEventListener('click', (e) => {
          e.stopPropagation()
          mk.onClick!()
        })
      }
      return new maplibregl.Marker({ element: div }).setLngLat([mk.lon, mk.lat]).addTo(m)
    })
  }, [markers])

  // Route line
  useEffect(() => {
    const m = map.current
    if (!m) return
    if (!ready.current) {
      pendingLine.current = line
      return
    }
    ;(m.getSource('route') as maplibregl.GeoJSONSource | undefined)?.setData(lineData(line))
    m.setPaintProperty('route', 'line-dasharray', dashed ? [1.5, 1.5] : undefined)
  }, [line, dashed])

  // Segments (road routes and straight legs)
  useEffect(() => {
    const m = map.current
    if (!m || !ready.current) return
    ;(m.getSource('seg-dashed') as maplibregl.GeoJSONSource | undefined)?.setData(segData(segments, true))
    ;(m.getSource('seg-solid') as maplibregl.GeoJSONSource | undefined)?.setData(segData(segments, false))
  }, [segments])

  // Fit to markers
  useEffect(() => {
    const m = map.current
    if (!m) return
    // Fit to the lines as drawn (across the Pacific if need be), and to the markers on the same side of the world.
    const drawn: [number, number][] = [...unwrapPath(line ?? []), ...unwrapSegments(segments ?? []).flatMap((s) => s.coords)]
    const ref = drawn[0]?.[0] ?? markers[0]?.lon ?? 0
    const pts: [number, number][] = [...markers.map((x) => [nearLon(x.lon, ref), x.lat] as [number, number]), ...drawn]
    if (pts.length === 0) return
    if (pts.length === 1) {
      m.easeTo({ center: pts[0], zoom: Math.max(m.getZoom(), 14) })
      return
    }
    const b = pts.reduce((acc, p) => acc.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]))
    m.fitBounds(b, { padding: 50, maxZoom: 16, duration: 400 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey])

  // Recentre when asked to
  useEffect(() => {
    if (center && map.current) map.current.easeTo({ center: [center.lon, center.lat], zoom })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center?.lat, center?.lon])

  return <div ref={el} className={`map ${className}`} />
}

function segData(segments: Props['segments'], dashed: boolean) {
  return {
    type: 'FeatureCollection' as const,
    features: unwrapSegments(segments ?? [])
      .filter((s) => s.dashed === dashed && s.coords.length > 1)
      .map((s) => ({ type: 'Feature' as const, properties: { color: s.color ?? '#0f766e' }, geometry: { type: 'LineString' as const, coordinates: s.coords } })),
  }
}

function lineData(line?: [number, number][]) {
  return { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: line && line.length > 1 ? unwrapPath(line) : [] } }
}
