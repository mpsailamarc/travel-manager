import { lazy, Suspense, type ComponentProps } from 'react'

// MapLibre is large; load it only on screens that show a map.
const MapView = lazy(() => import('./MapView'))

export default function LazyMap(props: ComponentProps<typeof MapView>) {
  return (
    <Suspense fallback={<div className={`map ${props.className ?? ''}`} />}>
      <MapView {...props} />
    </Suspense>
  )
}
export type { MapMarker } from './MapView'
