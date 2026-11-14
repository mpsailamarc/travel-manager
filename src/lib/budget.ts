// Rough, offline budget estimate. Deliberately simple: it's a starting point you then edit,
// or replace with the AI-generated budget.

import type { BudgetCategory, BudgetLevel, BudgetLine, Item, Trip } from '../types'
import { BUDGET_CATEGORIES } from '../types'
import { daysBetween } from './dates'
import { fxRate } from './apis'
import { plural } from './format'
import { uid } from './ids'

// Relative daily cost vs. Western Europe (1.0). Approximate.
const COST_INDEX: Record<string, number> = {
  CH: 1.6, NO: 1.5, IS: 1.5, DK: 1.35, SE: 1.2, GB: 1.25, IE: 1.25, US: 1.35, CA: 1.15, AU: 1.2, NZ: 1.15, SG: 1.25, AE: 1.2,
  FR: 1.1, NL: 1.15, BE: 1.05, DE: 1.0, AT: 1.05, IT: 1.0, ES: 0.9, PT: 0.8, GR: 0.85, MT: 0.85, HR: 0.85, JP: 1.0, KR: 0.9,
  CZ: 0.75, PL: 0.65, HU: 0.65, TR: 0.55, MA: 0.5, EG: 0.45, ZA: 0.6, KE: 0.7, IN: 0.35, LK: 0.4, TH: 0.45, VN: 0.35, ID: 0.4,
  CN: 0.6, MX: 0.6, CR: 0.85, CO: 0.5, PE: 0.5, BR: 0.6, AR: 0.5, CL: 0.65,
}

const CONTINENT: Record<string, string> = {
  CH: 'EU', NO: 'EU', IS: 'EU', DK: 'EU', SE: 'EU', GB: 'EU', IE: 'EU', FR: 'EU', NL: 'EU', BE: 'EU', DE: 'EU', AT: 'EU', IT: 'EU',
  ES: 'EU', PT: 'EU', GR: 'EU', MT: 'EU', HR: 'EU', CZ: 'EU', PL: 'EU', HU: 'EU', TR: 'EU',
  MA: 'AF', EG: 'AF', ZA: 'AF', KE: 'AF', AE: 'AS', IN: 'AS', LK: 'AS', TH: 'AS', VN: 'AS', ID: 'AS', CN: 'AS', JP: 'AS', KR: 'AS', SG: 'AS',
  US: 'NA', CA: 'NA', MX: 'NA', CR: 'NA', CO: 'SA', PE: 'SA', BR: 'SA', AR: 'SA', CL: 'SA', AU: 'OC', NZ: 'OC',
}

const LEVEL: Record<BudgetLevel, number> = { shoestring: 0.5, mid: 1, comfort: 1.7, luxury: 3 }

// Western-Europe, mid-range, EUR.
const PER_PERSON_DAY = { food: 45, transport: 12, activities: 22, other: 8 }
const ROOM_NIGHT = 120

/**
 * A rough estimate as lines with their assumptions (quantity × price per unit), e.g. "Accommodation: 3 nights × A$263".
 * Change the quantity or the price and the amount follows. Flights are left out when the trip starts in the same
 * country as the destination; a car in the plan adds rental and fuel lines (days × daily rate, km × price per km).
 */
export async function estimateBudgetLines(trip: Trip, homeCountry: string, homeCurrency: string, items: Item[] = []): Promise<BudgetLine[]> {
  const nights = Math.max(1, daysBetween(trip.startDate, trip.endDate))
  const days = nights + 1
  const idx = trip.countryCodes.length ? trip.countryCodes.reduce((s, c) => s + (COST_INDEX[c] ?? 0.9), 0) / trip.countryCodes.length : 1
  const lvl = LEVEL[trip.budgetLevel]
  const adults = trip.travellers.filter((t) => t.type === 'adult').length || 1
  const kids = trip.travellers.filter((t) => t.type === 'child').length
  const people = adults + kids * 0.6
  const personDays = Math.round(days * people * 10) / 10
  const rooms = Math.max(1, Math.ceil(adults / 2))
  const roomFactor = rooms + kids * 0.2
  const group = `${plural(adults, 'adult')}${kids ? ` + ${plural(kids, 'child', 'children')}` : ''}`

  // Where the trip starts decides whether flights are needed (the place's country when known, else your nationality).
  const startCountry = trip.startPlace?.country ?? homeCountry
  const startCont = CONTINENT[startCountry]
  const domestic = !!startCountry && trip.countryCodes.length > 0 && trip.countryCodes.every((c) => c === startCountry)
  const longHaul = trip.countryCodes.some((c) => CONTINENT[c] && startCont && CONTINENT[c] !== startCont)
  const flightPP = longHaul ? 850 : 180
  const hops = Math.max(0, trip.cities.length - 1)

  // A car in the plan: the days you have it run from its first to its last item.
  const carItems = items.filter((i) => (i.kind === 'car' || i.kind === 'drive') && i.status !== 'skipped')
  const carDates = carItems.map((i) => i.date).sort()
  const hasCar = carDates.length > 0
  const rented = carItems.some((i) => i.kind === 'car') // driving your own car has fuel but no rental
  // Only a pickup in the plan (no return noted)? Assume you keep the car for the whole trip: you can edit the quantity.
  const carSpan = hasCar ? daysBetween(carDates[0], carDates[carDates.length - 1]) + 1 : 0
  const carDays = hasCar ? (carSpan > 1 ? carSpan : days) : 0

  type Raw = { category: BudgetCategory; label: string; qty: number; unit: string; price: number } // price in EUR
  const raw: Raw[] = []
  const add = (category: BudgetCategory, label: string, qty: number, unit: string, price: number) => raw.push({ category, label, qty, unit, price })
  if (!domestic) {
    add('flights', 'Flights · adults', adults, adults === 1 ? 'traveller' : 'travellers', flightPP * Math.sqrt(lvl))
    if (kids) add('flights', 'Flights · children', kids, kids === 1 ? 'child' : 'children', 0.9 * flightPP * Math.sqrt(lvl))
  } else if (!hasCar) {
    add('transport', `Getting there and back from ${trip.startPlace?.name ?? 'home'} (fuel, parking or transit)`, 1, 'trip', 70 * idx * lvl)
  }
  if (hasCar) {
    if (rented) add('transport', 'Car rental', carDays, carDays === 1 ? 'day' : 'days', 55 * idx * Math.sqrt(lvl))
    add('transport', `Fuel${trip.startPlace?.name ? ` (from ${trip.startPlace.name})` : ''}`, carDays * 150, 'km', 0.12 * Math.min(idx, 1.2))
  }
  add('transport', 'Local transport', personDays, 'person-days', PER_PERSON_DAY.transport * idx * lvl)
  if (hops) add('transport', 'Moving between places', hops, hops === 1 ? 'move' : 'moves', 40 * people * idx * lvl)
  add('stays', `Accommodation (${plural(rooms, 'room')})`, nights, nights === 1 ? 'night' : 'nights', ROOM_NIGHT * roomFactor * idx * lvl)
  add('food', `Food & drink (${group})`, personDays, 'person-days', PER_PERSON_DAY.food * idx * lvl)
  add('activities', 'Activities & tickets', personDays, 'person-days', PER_PERSON_DAY.activities * idx * lvl)
  add('other', 'Other & contingency', personDays, 'person-days', PER_PERSON_DAY.other * idx * lvl)

  const rate = (await fxRate('EUR', homeCurrency)) ?? 1
  // Unit prices keep their cents when small (0.19 per km), whole amounts otherwise.
  const roundPrice = (n: number) => (n >= 100 ? Math.round(n) : Math.round(n * 100) / 100)
  return raw
    .map((l) => {
      const price = roundPrice(l.price * rate)
      return { id: uid(), category: l.category, label: l.label, qty: l.qty, unit: l.unit, price, amount: Math.round(l.qty * price) }
    })
    .filter((l) => l.amount > 0)
}

const UNIT_FORMS: Record<string, [string, string]> = { day: ['day', 'days'], night: ['night', 'nights'], move: ['move', 'moves'], traveller: ['traveller', 'travellers'], trip: ['trip', 'trips'], child: ['child', 'children'], ticket: ['ticket', 'tickets'], meal: ['meal', 'meals'] }

/** "4 day" → "4 days", "1 days" → "1 day": units follow the quantity, whichever form was typed. */
export function unitFor(qty: number, unit = ''): string {
  const key = unit.toLowerCase().replace(/s$/, '').replace(/^children$/, 'child').replace(/^childre$/, 'child')
  const forms = UNIT_FORMS[key] ?? UNIT_FORMS[unit.toLowerCase()]
  return forms ? (qty === 1 ? forms[0] : forms[1]) : unit
}

/** The amount of a line: quantity × price when both are filled in, otherwise the amount typed in. */
export const lineAmount = (l: BudgetLine) => (l.qty && l.price ? Math.round(l.qty * l.price) : l.amount)

/** Category totals for a trip: lines win where a category has them, manual amounts stay for the others. */
export function budgetFromLines(lines: BudgetLine[], previous: Trip['budget'], previousLines: BudgetLine[] = []): Trip['budget'] {
  const budget = { ...previous }
  for (const c of BUDGET_CATEGORIES) {
    const mine = lines.filter((l) => l.category === c)
    if (mine.length) budget[c] = mine.reduce((s, l) => s + (lineAmount(l) || 0), 0)
    else if (previousLines.some((l) => l.category === c)) delete budget[c] // its last line was removed
  }
  return budget
}

export const BUDGET_LABELS: Record<BudgetCategory, { label: string; emoji: string }> = {
  flights: { label: 'Flights', emoji: '✈️' },
  transport: { label: 'Local transport', emoji: '🚆' },
  stays: { label: 'Accommodation', emoji: '🛏️' },
  food: { label: 'Food & drink', emoji: '🍽️' },
  activities: { label: 'Activities & tickets', emoji: '🎟️' },
  other: { label: 'Other', emoji: '🧾' },
}
