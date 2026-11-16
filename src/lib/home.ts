// Where the trip starts and ends (home, usually) is only that: a starting point. It isn't one of the trip's places, gets
// no activities, no ideas from ChatGPT and no tab in the City planner — unless the whole trip is there (a trip at home).

import type { Trip } from '../types'
import { haversineM } from './geo'
import { cityBase, sameCity } from './favorites'

/** Is this place (by name, or within 50 km) where the trip starts or ends? */
export function isHome(trip: Pick<Trip, 'startPlace' | 'endPlace'>, place: { name?: string; lat?: number; lon?: number }): boolean {
  for (const h of [trip.startPlace, trip.endPlace]) {
    if (!h?.name) continue
    if (place.name && (sameCity(cityBase(place.name), cityBase(h.name.split(',')[0])) || sameCity(place.name, h.name))) return true
    if (h.lat != null && h.lon != null && place.lat != null && place.lon != null && haversineM({ lat: h.lat, lon: h.lon }, { lat: place.lat, lon: place.lon }) < 50_000) return true
  }
  return false
}
