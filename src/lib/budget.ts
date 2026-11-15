// Rough, offline budget estimate. Deliberately simple: it's a starting point you then edit,
// or replace with the AI-generated budget.

import type { BudgetCategory, BudgetLevel, BudgetLine, Item, Trip } from '../types'
import { BUDGET_CATEGORIES } from '../types'
import { daysBetween } from './dates'
import { fxRate } from './apis'
import { country } from './countries'
import { money, plural } from './format'
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
export async function estimateBudgetLines(trip: Trip, homeCountry: string, homeCurrency: string, items: Item[] = []): Promise<{ lines: BudgetLine[]; basis: string[] }> {
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
  const travellers = adults + kids
  if (!domestic) {
    // One line for everyone: children travel at 90% of an adult fare, so the price shown is the average per traveller.
    add('flights', `Flights, return (${group})`, travellers, travellers === 1 ? 'traveller' : 'travellers', ((adults + kids * 0.9) / travellers) * flightPP * Math.sqrt(lvl))
  } else if (!hasCar) {
    add('transport', `Getting there and back from ${trip.startPlace?.name ?? 'home'} (fuel, parking or transit)`, 1, 'trip', 70 * idx * lvl)
  }
  if (hasCar) {
    if (rented) add('transport', 'Car rental', carDays, carDays === 1 ? 'day' : 'days', 55 * idx * Math.sqrt(lvl))
    // "from home" only when you drive from there; flying in, the car is picked up at the destination.
    add('transport', `Fuel${domestic && trip.startPlace?.name ? ` (from ${trip.startPlace.name})` : ''}`, carDays * 150, 'km', 0.12 * Math.min(idx, 1.2))
  }
  add('transport', 'Local transport', personDays, 'person-days', PER_PERSON_DAY.transport * idx * lvl)
  if (hops) add('transport', 'Moving between places', hops, hops === 1 ? 'move' : 'moves', 40 * people * idx * lvl)
  add('stays', `Accommodation (${plural(rooms, 'room')})`, nights, nights === 1 ? 'night' : 'nights', ROOM_NIGHT * roomFactor * idx * lvl)
  add('food', `Food & drink (${group})`, personDays, 'person-days', PER_PERSON_DAY.food * idx * lvl)
  add('activities', 'Activities & tickets', personDays, 'person-days', PER_PERSON_DAY.activities * idx * lvl)
  add('other', 'Other & contingency', personDays, 'person-days', PER_PERSON_DAY.other * idx * lvl)

  const rate = (await fxRate('EUR', homeCurrency)) ?? 1
  const names = trip.countryCodes.map((c) => country(c)?.name).filter(Boolean).join(' & ')
  const pct = Math.round((idx - 1) * 100)
  const where = names || 'your destination'
  const basis = [
    `Prices start from typical Western-Europe costs and are scaled for ${where}: ${pct === 0 ? 'about the same as' : `about ${Math.abs(pct)}% ${pct > 0 ? 'above' : 'below'}`} Western Europe.`,
    `Budget level “${trip.budgetLevel}” scales them by ×${lvl}.`,
    `For ${group}, ${plural(days, 'day')} and ${plural(nights, 'night')} (${plural(rooms, 'room')}).`,
    domestic
      ? `No flights: you start in the same country as the destination${trip.startPlace?.name ? ` (${trip.startPlace.name})` : ''}.`
      : `Flights: a return fare of about ${money(flightPP * Math.sqrt(lvl) * rate, homeCurrency)} per adult (${longHaul ? 'long-haul' : 'short-haul'}), children at 90%. Remove the line if you already have your tickets${trip.startPlace?.name ? '' : ', or set where you start in Trip details if you start close to the destination'}.`,
    ...(hasCar
      ? [`Car: ${rented ? `rental of about ${money(55 * idx * Math.sqrt(lvl) * rate, homeCurrency)} a day, plus ` : ''}fuel at about ${money(0.12 * Math.min(idx, 1.2) * rate, homeCurrency, 2)} per km, for ${plural(carDays, 'day')} at roughly 150 km a day.`]
      : []),
    homeCurrency === 'EUR' ? 'Amounts are in euros.' : `Amounts are converted to ${homeCurrency} at today's rate (1 EUR = ${rate.toFixed(2)} ${homeCurrency}).`,
    'These are rough guesses, not quotes. Change any quantity or price, remove lines you don\'t need, and swap in real prices as you book.',
  ]
  // Unit prices keep their cents when small (0.19 per km), whole amounts otherwise.
  const roundPrice = (n: number) => (n >= 100 ? Math.round(n) : Math.round(n * 100) / 100)
  const lines = raw
    .map((l) => {
      const price = roundPrice(l.price * rate)
      return { id: uid(), category: l.category, label: l.label, qty: l.qty, unit: l.unit, price, amount: Math.round(l.qty * price) }
    })
    .filter((l) => l.amount > 0)
  return { lines, basis }
}

/** Who is travelling and for how long, as the estimate counts it. */
function party(trip: Trip) {
  const nights = Math.max(1, daysBetween(trip.startDate, trip.endDate))
  const adults = trip.travellers.filter((t) => t.type === 'adult').length || 1
  const kids = trip.travellers.filter((t) => t.type === 'child').length
  const rooms = Math.max(1, Math.ceil(adults / 2))
  return {
    nights,
    days: nights + 1,
    adults,
    kids,
    people: adults + kids * 0.6,
    travellers: adults + kids,
    rooms,
    roomFactor: rooms + kids * 0.2,
    group: `${plural(adults, 'adult')}${kids ? ` + ${plural(kids, 'child', 'children')}` : ''}`,
  }
}

/**
 * The trip changed (more or fewer travellers, other dates): estimate lines that depend on it follow, so the budget at the top
 * changes too. Per-person-per-day lines scale with people × days, flights with the number of travellers, accommodation
 * with the nights and rooms, moves between places with the group. Amounts typed without a quantity × price stay as they are.
 */
export function adjustLinesToTrip(lines: BudgetLine[], before: Trip, after: Trip): BudgetLine[] {
  const a = party(before)
  const b = party(after)
  if (a.days === b.days && a.adults === b.adults && a.kids === b.kids) return lines
  const round1 = (n: number) => Math.round(n * 10) / 10
  return lines.map((l) => {
    if (!l.qty || !l.price) return l
    const unit = l.unit ?? ''
    let { qty, price } = l
    if (/person-day/.test(unit)) qty = round1((qty * (b.days * b.people)) / (a.days * a.people))
    else if (/^travellers?$/.test(unit) && qty === a.travellers) qty = b.travellers
    else if (l.category === 'stays' && /^nights?$/.test(unit)) {
      if (qty === a.nights) qty = b.nights
      price = Math.round((price * b.roomFactor) / a.roomFactor)
    } else if (/^moves?$/.test(unit)) price = Math.round((price * b.people) / a.people)
    const label = l.label.replace(`(${a.group})`, `(${b.group})`).replace(`(${plural(a.rooms, 'room')})`, `(${plural(b.rooms, 'room')})`)
    const unitFixed = /^travellers?$/.test(unit) ? (qty === 1 ? 'traveller' : 'travellers') : /^nights?$/.test(unit) ? (qty === 1 ? 'night' : 'nights') : l.unit
    const next = { ...l, qty, price, label, unit: unitFixed }
    return { ...next, amount: lineAmount(next) }
  })
}

/** "per night", "per person per day", "each": what a unit price is for, so "A$263" is never a mystery. */
export function perPhrase(unit = ''): string {
  const u = unit.toLowerCase()
  if (!u) return ''
  if (u === 'person-days') return 'per person per day'
  if (/^(traveller|adult|child|children|person|people)s?$/.test(u)) return 'each'
  return `per ${unitFor(1, unit)}`
}

const UNIT_FORMS: Record<string, [string, string]> = { day: ['day', 'days'], night: ['night', 'nights'], move: ['move', 'moves'], traveller: ['traveller', 'travellers'], trip: ['trip', 'trips'], child: ['child', 'children'], ticket: ['ticket', 'tickets'], meal: ['meal', 'meals'] }

/** "4 day" → "4 days", "1 days" → "1 day": units follow the quantity, whichever form was typed. */
export function unitFor(qty: number, unit = ''): string {
  const key = unit.toLowerCase().replace(/s$/, '').replace(/^children$/, 'child').replace(/^childre$/, 'child')
  const forms = UNIT_FORMS[key] ?? UNIT_FORMS[unit.toLowerCase()]
  return forms ? (qty === 1 ? forms[0] : forms[1]) : unit
}

const LABEL_QTY = /(\d+(?:[.,]\d+)?)\s*(days?|nights?|moves?|adults?|children|child|travellers?|person-days)\b/i

/**
 * A line made before assumptions existed has no quantity or price. Read them back from its label ("… · 3 nights × 1 room"
 * gives 3 nights at amount ÷ 3); with `fallback`, any other line becomes "1 × its amount", so the fields are never empty.
 */
export function inferAssumption(l: BudgetLine, fallback = false): BudgetLine {
  if ((l.qty && l.price) || !l.amount) return l.qty || !fallback ? l : { ...l, qty: 1 }
  const m = l.label.match(LABEL_QTY)
  if (!m && !fallback) return l
  const qty = m ? Number(m[1].replace(',', '.')) || 1 : 1
  const unit = m ? m[2].toLowerCase().replace(/^adult$/, 'adults') : l.unit
  return { ...l, qty, unit, price: Math.round((l.amount / qty) * 100) / 100 }
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
