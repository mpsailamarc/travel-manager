// Small geometry helpers and a route-order optimiser that runs in the browser.

export interface LatLon {
  lat: number
  lon: number
}

export function haversineM(a: LatLon, b: LatLon): number {
  const R = 6371000
  const toRad = (x: number) => (x * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/**
 * Order stops to minimise walking distance, starting at `start`.
 * Nearest-neighbour seed followed by 2-opt improvement; good enough (and instant) for 2–25 stops.
 * Street distance is roughly proportional to straight-line distance in a city, so this is a fair proxy.
 */
export function optimiseOrder<T extends LatLon>(start: LatLon, stops: T[], roundTrip: boolean): T[] {
  if (stops.length < 3) return nearestNeighbour(start, stops)
  const pts: LatLon[] = [start, ...stops]
  const n = pts.length
  const dist = pts.map((a) => pts.map((b) => haversineM(a, b)))

  let route = [0, ...nearestNeighbour(start, stops).map((s) => stops.indexOf(s) + 1)]
  const cost = (r: number[]) => {
    let c = 0
    for (let i = 0; i < r.length - 1; i++) c += dist[r[i]][r[i + 1]]
    if (roundTrip) c += dist[r[r.length - 1]][0]
    return c
  }

  let improved = true
  let best = cost(route)
  while (improved) {
    improved = false
    for (let i = 1; i < n - 1; i++) {
      for (let k = i + 1; k < n; k++) {
        const next = [...route.slice(0, i), ...route.slice(i, k + 1).reverse(), ...route.slice(k + 1)]
        const c = cost(next)
        if (c + 1e-6 < best) {
          route = next
          best = c
          improved = true
        }
      }
    }
  }
  return route.slice(1).map((i) => stops[i - 1])
}

function nearestNeighbour<T extends LatLon>(start: LatLon, stops: T[]): T[] {
  const left = [...stops]
  const out: T[] = []
  let cur: LatLon = start
  while (left.length) {
    let bi = 0
    let bd = Infinity
    left.forEach((s, i) => {
      const d = haversineM(cur, s)
      if (d < bd) {
        bd = d
        bi = i
      }
    })
    cur = left[bi]
    out.push(left.splice(bi, 1)[0])
  }
  return out
}

export function centroid(points: LatLon[]): LatLon | undefined {
  if (!points.length) return undefined
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
    lon: points.reduce((s, p) => s + p.lon, 0) / points.length,
  }
}
