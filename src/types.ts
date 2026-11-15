// Core data model. Everything is stored on the device (IndexedDB) and can be exported as JSON.

export type ISODate = string // YYYY-MM-DD
export type HHMM = string // 24h "09:30"

export interface Place {
  name: string
  lat?: number
  lon?: number
  country?: string // ISO alpha-2, when it came from a place search
}

export interface Money {
  amount: number
  currency: string // ISO 4217
}

export type TravellerType = 'adult' | 'child'

export interface Traveller {
  id: string
  name: string
  type: TravellerType
  age?: number
}

export type TripStyle = 'relaxed' | 'balanced' | 'packed'
export type BudgetLevel = 'shoestring' | 'mid' | 'comfort' | 'luxury'
export type TripFocus = 'cities' | 'mix' | 'outdoors'
export type InnerFlights = 'auto' | 'fly' | 'few' | 'none'

export const BUDGET_CATEGORIES = ['flights', 'transport', 'stays', 'food', 'activities', 'other'] as const
export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number]

export interface BudgetLine {
  id: string
  category: BudgetCategory
  label: string
  amount: number // home currency; qty × price when both are set
  qty?: number // the assumption behind the amount, e.g. 4 (days)…
  unit?: string // …"days", "km", "nights"…
  price?: number // …and the price per unit in home currency…
  per?: 'person' | 'room' // …paid per person or per room (then × count), else for everyone together…
  count?: number // …how many people or rooms
}

export interface Trip {
  id: string
  name: string
  countryCodes: string[] // ISO 3166-1 alpha-2
  cities: string[]
  startDate: ISODate
  endDate: ISODate
  travellers: Traveller[]
  style: TripStyle
  budgetLevel: BudgetLevel
  interests: string[]
  focus?: TripFocus // cities and sights, a mix, or a road trip with hikes (unset = a mix)
  innerFlights?: InnerFlights // flights between places inside the trip (unset = 'auto': the planner decides, by group size)
  notes?: string
  budget: Partial<Record<BudgetCategory, number>> // in home currency
  budgetLines?: BudgetLine[] // the estimate's breakdown; per-category totals in `budget` follow these
  budgetBasis?: string[] // plain-words notes on how the estimate was made
  planBudget?: BudgetCategory[] // categories whose budget came from an itinerary idea (so switching idea can replace them)
  userEndDate?: ISODate // the end date you chose, when an itinerary idea made the trip longer
  fuel?: { km?: number; perKm?: number } // your own figures for the fuel line (else worked out from the drives)
  planBasis?: string // what the itinerary was made for (destination, dates, pace…): when the trip no longer matches, new ideas are offered
  startPlace?: Place // where the trip starts (e.g. home city or airport)
  endPlace?: Place // where it ends; the start place when not set
  coverEmoji: string
  createdAt: number
  updatedAt: number
}

export interface Day {
  id: string // `${tripId}:${date}`
  tripId: string
  date: ISODate
  city?: string
  lat?: number
  lon?: number
  title?: string
  notes?: string
  tz?: string // IANA time zone, when set by hand; otherwise worked out from the city's coordinates
  // The day's walking tour in the City planner: where it starts (default: tonight's stay, else the city centre), when, and whether it ends back there.
  walkStart?: Place
  walkStartTime?: HHMM
  walkRoundTrip?: boolean
  getAround?: GetAround // overrides the Settings default for this day
}

export const TRANSPORT_KINDS = ['flight', 'train', 'bus', 'car', 'drive', 'ferry', 'taxi'] as const
export type TransportKind = (typeof TRANSPORT_KINDS)[number]
export type ItemKind = TransportKind | 'stay' | 'activity' | 'meal' | 'walk' | 'note'
export type ItemStatus = 'idea' | 'planned' | 'booked' | 'done' | 'skipped'

export interface WalkStop {
  id: string // OSM id
  name: string
  lat: number
  lon: number
  category: string
  visitMin: number
  wikipedia?: string // "en:Belém Tower"
  wikidata?: string
}

export interface WalkRoute {
  start: Place
  roundTrip: boolean
  stops: WalkStop[]
  geometry: [number, number][] // [lon, lat]
  legs: { distanceM: number; durationS: number }[]
  distanceM: number
  walkS: number
  routedBy: 'osrm' | 'straight-line'
}

/** How to get between two places in a day. Public transport is an estimate (there is no free routing service for it). */
export type LegMode = 'walk' | 'transit' | 'taxi' | 'drive'
export type GetAround = 'walk' | 'transit' | 'taxi' | 'fastest' | 'car' // walk everywhere · walk short hops, else public transport · …else taxi · whichever is quickest · …else drive your car

export interface Leg {
  mode: LegMode
  minutes: number
  distanceM: number
  estimated?: boolean // true for public transport, and for anything worked out without the routing service
  geometry?: [number, number][] // [lon, lat]
  fromName?: string
}

export interface Item {
  id: string
  tripId: string
  date: ISODate
  kind: ItemKind
  title: string
  startTime?: HHMM
  endTime?: HHMM
  from?: Place // transport
  to?: Place // transport
  location?: Place // stays, activities
  nights?: number // stays
  bookingRef?: string
  provider?: string
  url?: string
  cost?: Money
  status: ItemStatus
  notes?: string
  order: number
  walk?: WalkRoute
  fromTz?: string // zone of the start time of a transport item (e.g. Australia/Sydney), when not the obvious one
  toTz?: string // zone of its end time (e.g. Asia/Tokyo)
  planner?: string // set on items built from favourites ("fav:<city>") so they can be rebuilt
  favId?: string // the wishlist place this item came from
  category?: string // the wishlist place's kind (museum, park…), to guess opening hours
  hours?: string // published opening hours (OpenStreetMap format, e.g. "Tu-Su 10:00-18:00")
  legIn?: Leg // how to get here from the previous place of the day (set by the City planner)
  locked?: boolean // 📌 keep this time: optimising and planning never move it (booked items, journeys and stays are always kept)
  autoTime?: boolean // its time was set by "Plan my days" (it had none): planning again may move it; editing it by hand makes the time yours
}

export const CHECKLIST_CATEGORIES = ['documents', 'health', 'bookings', 'money', 'tech', 'packing', 'kids', 'other'] as const
export type ChecklistCategory = (typeof CHECKLIST_CATEGORIES)[number]

export interface ChecklistItem {
  id: string
  tripId: string
  title: string
  category: ChecklistCategory
  done: boolean
  dueDate?: ISODate
  notes?: string
  link?: string
  altLink?: string // a second place to look (Tripadvisor), next to the main link
  ruleId?: string // set when generated by the rule engine; avoids duplicates on regeneration
  locked?: boolean // you edited a suggested entry: the automatic refresh no longer rewrites its text, date or link
  dismissed?: boolean // a suggestion you deleted: kept (hidden) so the automatic refresh doesn't bring it back
  order: number
}

export const EXPENSE_CATEGORIES = BUDGET_CATEGORIES
export interface Expense {
  id: string
  tripId: string
  date: ISODate
  amount: number
  currency: string
  amountHome: number // converted at time of entry
  category: BudgetCategory
  note?: string
  createdAt: number
}

export interface TripDocument {
  id: string
  tripId: string
  name: string
  mime: string
  size: number
  blob: Blob
  note?: string
  addedAt: number
}

/** Something you'd like to do in a city, not necessarily on a day yet. */
export interface Favorite {
  id: string
  tripId: string
  city: string // display name, as on the trip's days
  name: string
  lat?: number
  lon?: number
  category: string
  visitMin: number
  indoor?: boolean
  source: 'sight' | 'ai' | 'manual'
  wikipedia?: string
  wikidata?: string
  openingHours?: string // from OpenStreetMap when known ("Tu-Su 10:00-18:00")
  interest?: { stars: number; langs: number } // how widely written about (Wikipedia language editions), 1–5 stars
  notes?: string
  date?: ISODate // undefined = not scheduled (a backup idea)
  pinned?: boolean // you chose the day yourself; "Plan my days" keeps it
  itemId?: string // added on the day as its own plan item (from Today)
  addedAt: number
}

export interface Settings {
  id: 'me'
  name: string
  homeCurrency: string
  nationality: string // ISO alpha-2
  homeAirport?: string
  walkSpeedKmh: number
  getAround?: GetAround // City planner default between places (default: walk short hops, public transport for longer ones)
  walkMaxMin?: number // what counts as a short hop, in minutes of walking (default 15)
}
