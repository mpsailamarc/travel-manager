// Rough, offline budget estimate. Deliberately simple: it's a starting point you then edit,
// or replace with the AI-generated budget.

import type { BudgetCategory, BudgetLevel, BudgetLine, Day, Item, Trip } from '../types'
import { BUDGET_CATEGORIES } from '../types'
import { daysBetween } from './dates'
import { haversineM, type LatLon } from './geo'
import { fxRate } from './apis'
import { db } from '../db'
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

  // Every line says how it's paid: per person (× the number of travellers), per room (× rooms), or once for everyone.
  // Children's lower prices are averaged into the price per person, so "4 people × €40 per person per day" adds up.
  type Raw = { category: BudgetCategory; label: string; qty: number; unit: string; price: number; per?: 'person' | 'room'; count?: number } // price in EUR
  const raw: Raw[] = []
  const add = (category: BudgetCategory, label: string, qty: number, unit: string, price: number, per?: 'person' | 'room', count?: number) =>
    raw.push({ category, label, qty, unit, price, per, count })
  const travellers = adults + kids
  const avg = (childShare: number) => (adults + kids * childShare) / travellers // average price per person, adult = 1
  if (!domestic) {
    add('flights', 'Flights, return', 1, 'return flight', flightPP * Math.sqrt(lvl) * avg(0.9), 'person', travellers)
  } else if (!hasCar) {
    add('transport', `Getting there and back from ${trip.startPlace?.name ?? 'home'} (fuel, parking or transit)`, 1, 'trip', 70 * idx * lvl)
  }
  if (hasCar) {
    if (rented) add('transport', 'Car rental', carDays, carDays === 1 ? 'day' : 'days', 55 * idx * Math.sqrt(lvl))
    // "from home" only when you drive from there; flying in, the car is picked up at the destination.
    add('transport', `Fuel${domestic && trip.startPlace?.name ? ` (from ${trip.startPlace.name})` : ''}`, carDays * 150, 'km', 0.12 * Math.min(idx, 1.2))
  }
  add('transport', 'Local transport', days, 'days', PER_PERSON_DAY.transport * idx * lvl * avg(0.6), 'person', travellers)
  if (hops) add('transport', 'Moving between places', hops, hops === 1 ? 'move' : 'moves', 40 * idx * lvl * avg(0.6), 'person', travellers)
  add('stays', 'Accommodation', nights, nights === 1 ? 'night' : 'nights', ROOM_NIGHT * idx * lvl * (roomFactor / rooms), 'room', rooms)
  add('food', 'Food & drink', days, 'days', PER_PERSON_DAY.food * idx * lvl * avg(0.6), 'person', travellers)
  add('activities', 'Activities & tickets', days, 'days', PER_PERSON_DAY.activities * idx * lvl * avg(0.6), 'person', travellers)
  add('other', 'Other & contingency', days, 'days', PER_PERSON_DAY.other * idx * lvl * avg(0.6), 'person', travellers)

  const rate = (await fxRate('EUR', homeCurrency)) ?? 1
  const names = trip.countryCodes.map((c) => country(c)?.name).filter(Boolean).join(' & ')
  const pct = Math.round((idx - 1) * 100)
  const where = names || 'your destination'
  const basis = [
    `Prices start from typical Western-Europe costs and are scaled for ${where}: ${pct === 0 ? 'about the same as' : `about ${Math.abs(pct)}% ${pct > 0 ? 'above' : 'below'}`} Western Europe.`,
    `Budget level “${trip.budgetLevel}” scales them by ×${lvl}.`,
    `For ${group}, ${plural(days, 'day')} and ${plural(nights, 'night')} (${plural(rooms, 'room')}).`,
    ...(kids ? ['Prices per person are averages for the group: children count as about 60% of an adult for food and activities, 90% for flights.'] : []),
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
  // so the sum on screen is the sum that's added: "3 people × €29" really is €87.
  const roundPrice = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 100) / 100)
  const lines = raw
    .map((l) => {
      const price = roundPrice(l.price * rate)
      const line: BudgetLine = { id: uid(), category: l.category, label: l.label, qty: l.qty, unit: l.unit, price, per: l.per, count: l.count, amount: 0 }
      return { ...line, amount: lineAmount(line) }
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
    lvl: LEVEL[trip.budgetLevel] ?? 1,
    idx: trip.countryCodes.length ? trip.countryCodes.reduce((s, c) => s + (COST_INDEX[c] ?? 0.9), 0) / trip.countryCodes.length : 1,
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
  if (a.days === b.days && a.adults === b.adults && a.kids === b.kids && a.lvl === b.lvl && a.idx === b.idx) return lines
  const round1 = (n: number) => Math.round(n * 10) / 10
  // Another budget level or destination: prices follow its level (flights by its square root, as estimated) and local costs.
  const cost = (l: BudgetLine) => (l.category === 'flights' ? Math.sqrt(b.lvl / a.lvl) : (b.lvl / a.lvl) * (b.idx / a.idx))
  lines = lines.map((l) => (l.qty && l.price && cost(l) !== 1 ? { ...l, price: Math.round(l.price * cost(l) * 100) / 100 } : l))
  const avgA = (w: number) => (a.adults + a.kids * w) / a.travellers
  const avgB = (w: number) => (b.adults + b.kids * w) / b.travellers
  return lines.map((l) => {
    if (!l.qty || !l.price) return l
    if (l.per) {
      // People and rooms are counted out, so they just follow; so do the days and nights when they were the trip's.
      const next = { ...l }
      if (l.per === 'person') {
        if (l.count === a.travellers) next.count = b.travellers
        const w = l.category === 'flights' ? 0.9 : 0.6
        next.price = Math.round(((l.price * avgB(w)) / avgA(w)) * 100) / 100 // the children's share of the average
      } else {
        if (l.count === a.rooms) next.count = b.rooms
        next.price = Math.round((l.price * (b.roomFactor / b.rooms)) / (a.roomFactor / a.rooms))
      }
      const u = (l.unit ?? '').toLowerCase()
      if (/^days?$/.test(u) && l.qty === a.days) next.qty = b.days
      if (/^nights?$/.test(u) && l.qty === a.nights) next.qty = b.nights
      next.unit = /^days?$/.test(u) ? (next.qty === 1 ? 'day' : 'days') : /^nights?$/.test(u) ? (next.qty === 1 ? 'night' : 'nights') : l.unit
      return { ...next, amount: lineAmount(next) }
    }
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

/** The "For 2 adults, 4 days and 3 nights (1 room)." line of "How this was estimated", for the trip as it is now. */
function groupBasis(trip: Trip) {
  const p = party(trip)
  return `For ${p.group}, ${plural(p.days, 'day')} and ${plural(p.nights, 'night')} (${plural(p.rooms, 'room')}).`
}

/** "How this was estimated" follows the trip too: the sentence about the group and its length is rewritten. */
export function adjustBasisToTrip(basis: string[] | undefined, after: Trip): string[] | undefined {
  if (!basis) return basis
  return basis.map((b) => (/^For .+ (day|night)s?\b.*\)\.$/.test(b) ? groupBasis(after) : b))
}

const PER_TRAVELLER: ReadonlySet<string> = new Set(['flight', 'train', 'bus', 'ferry'])
const PER_PERSON: ReadonlySet<string> = new Set(['activity', 'meal', 'walk'])

/**
 * Prices on plan items that are only estimates (not booked, no booking reference) are for the group as it was: with more
 * or fewer travellers, fares follow the number of travellers, tickets and meals the group size, hotels the rooms.
 * Booked prices are real and stay; taxis and cars cost the same for everyone.
 */
export function scaleCostsForGroup(items: Item[], before: Trip, after: Trip): { id: string; cost: NonNullable<Item['cost']> }[] {
  const a = party(before)
  const b = party(after)
  if (a.adults === b.adults && a.kids === b.kids) return []
  return items.flatMap((i) => {
    if (!i.cost?.amount || i.status === 'booked' || i.status === 'done' || i.bookingRef) return []
    const f = PER_TRAVELLER.has(i.kind) ? b.travellers / a.travellers : PER_PERSON.has(i.kind) ? b.people / a.people : i.kind === 'stay' ? b.roomFactor / a.roomFactor : 1
    if (f === 1) return []
    return [{ id: i.id, cost: { ...i.cost, amount: Math.round(i.cost.amount * f) } }]
  })
}

/**
 * Category figures that came from an itinerary idea (no lines) were for the group as it was: they follow it too.
 * Figures you typed yourself stay as they are.
 */
export function adjustPlanBudgetToTrip(budget: Trip['budget'], planBudget: Trip['planBudget'], lines: BudgetLine[] | undefined, before: Trip, after: Trip): Trip['budget'] {
  const a = party(before)
  const b = party(after)
  if (a.days === b.days && a.adults === b.adults && a.kids === b.kids && a.lvl === b.lvl && a.idx === b.idx) return budget
  const out = { ...budget }
  for (const c of planBudget ?? []) {
    if (!out[c] || lines?.some((l) => l.category === c)) continue
    const f =
      c === 'flights' ? b.travellers / a.travellers : c === 'stays' ? (b.roomFactor * b.nights) / (a.roomFactor * a.nights) : (b.people * b.days) / (a.people * a.days)
    const level = c === 'flights' ? Math.sqrt(b.lvl / a.lvl) : (b.lvl / a.lvl) * (b.idx / a.idx)
    out[c] = Math.round(out[c]! * f * level)
  }
  return out
}

/**
 * After the trip changed (who is travelling, the dates, the budget level, the destination), bring its budget in line: the
 * estimate's lines and note, figures from an itinerary idea, and the estimated prices of plan items. Returns what changed.
 */
export async function syncBudgetToTrip(before: Trip, after: Trip): Promise<{ lines: boolean; prices: number }> {
  const budgetLines = after.budgetLines ? adjustLinesToTrip(after.budgetLines, before, after) : undefined
  const linesChanged = !!budgetLines && budgetLines !== after.budgetLines
  const budget = adjustPlanBudgetToTrip(linesChanged ? budgetFromLines(budgetLines!, after.budget, after.budgetLines) : after.budget, after.planBudget, budgetLines, before, after)
  const budgetBasis = linesChanged ? adjustBasisToTrip(after.budgetBasis, after) : after.budgetBasis
  const prices = scaleCostsForGroup(await db.items.where('tripId').equals(after.id).toArray(), before, after)
  if (linesChanged || budget !== after.budget) await db.trips.update(after.id, { budgetLines, budget, budgetBasis })
  if (prices.length) await db.items.bulkUpdate(prices.map((p) => ({ key: p.id, changes: { cost: p.cost } })))
  return { lines: linesChanged || budget !== after.budget, prices: prices.length }
}

/** "per night", "per person per day", "each": what a unit price is for, so "A$263" is never a mystery. */
export function perPhrase(unit = '', per?: BudgetLine['per']): string {
  const u = unit.toLowerCase()
  const one = unitFor(1, unit)
  if (per === 'person') return /^(days?|nights?|moves?)$/.test(u) ? `per person per ${one}` : 'per person'
  if (per === 'room') return /^nights?$/.test(u) ? 'per room per night' : 'per room'
  if (!u) return ''
  if (u === 'person-days') return 'per person per day'
  if (/^(traveller|adult|child|children|person|people)s?$/.test(u)) return 'each'
  return `per ${unitFor(1, unit)}`
}

const UNIT_FORMS: Record<string, [string, string]> = {
  day: ['day', 'days'],
  night: ['night', 'nights'],
  move: ['move', 'moves'],
  traveller: ['traveller', 'travellers'],
  trip: ['trip', 'trips'],
  child: ['child', 'children'],
  ticket: ['ticket', 'tickets'],
  meal: ['meal', 'meals'],
  'return flight': ['return flight', 'return flights'],
}

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

/** The amount of a line: quantity × (people or rooms) × price when filled in, otherwise the amount typed in. */
export const lineAmount = (l: BudgetLine) => (l.qty && l.price ? Math.round(l.qty * l.price * (l.per ? l.count ?? 1 : 1)) : l.amount)

/** "4 days × 2 people × €45 per person per day", "3 nights × 1 room × €120 per room per night", "600 km × €0.15 per km". */
export function lineFormula(l: BudgetLine, fmt: (n: number) => string): string | undefined {
  if (!l.qty || !l.price) return undefined
  const parts = [`${l.qty} ${unitFor(l.qty, l.unit)}`.trim()]
  if (l.per === 'person') parts.push(`${l.count ?? 1} ${(l.count ?? 1) === 1 ? 'person' : 'people'}`)
  if (l.per === 'room') parts.push(plural(l.count ?? 1, 'room'))
  return `${parts.join(' × ')} × ${fmt(l.price)} ${perPhrase(l.unit, l.per)}`.trim()
}

/**
 * Lines from earlier estimates counted "person-days" (8.4 of them, with children at 60%) or a price per night for all rooms
 * together, which didn't read as a sum. They become "days × people × price per person" and "nights × rooms × price per room",
 * keeping the amount.
 */
export function modernLine(l: BudgetLine, trip: Trip): BudgetLine {
  if (l.per || !l.qty || !l.price) return l
  const p = party(trip)
  const unit = (l.unit ?? '').toLowerCase()
  const amount = lineAmount(l)
  const label = l.label.replace(/\s*\((\d+ adults?( \+ \d+ child(ren)?)?|\d+ rooms?)\)/, '')
  const two = (n: number) => Math.round(n * 100) / 100
  if (unit === 'person-days') return { ...l, label, qty: p.days, unit: 'days', per: 'person', count: p.travellers, price: two(amount / (p.days * p.travellers)), amount }
  if (/^travellers?$/.test(unit)) return { ...l, label: 'Flights, return', qty: 1, unit: 'return flight', per: 'person', count: l.qty, price: l.price, amount }
  if (l.category === 'stays' && /^nights?$/.test(unit)) return { ...l, label, per: 'room', count: p.rooms, price: two(amount / (l.qty * p.rooms)), amount }
  if (/^moves?$/.test(unit)) return { ...l, label, per: 'person', count: p.travellers, price: two(amount / (l.qty * p.travellers)), amount }
  return l
}

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

/** Fuel per km for a normal car, in euros (about 7 l/100 km at ~€1.85 a litre). */
export const FUEL_EUR_PER_KM = 0.13

/**
 * Fuel for a trip with a car (rented or your own): the road distance between the places you stay while you have the car,
 * plus about 30 km a day of local driving. Straight-line distance × 1.3 stands in for the road.
 */
// Further than this between two nights (as the crow flies) isn't a drive: you flew, or the places are wrong.
const MAX_DRIVE_M = 1000_000

export function fuelEstimate(items: Item[], days: Day[]): { km: number; route: string[] } | undefined {
  const car = items.filter((i) => (i.kind === 'car' || i.kind === 'drive') && i.status !== 'skipped').map((i) => i.date).sort()
  if (!car.length) return undefined
  const [from, to] = [car[0], car[car.length - 1]]
  // From where you pick the car up: the place you slept the night before the first car day.
  const sorted = days.filter((d) => d.lat != null && d.lon != null).sort((a, b) => a.date.localeCompare(b.date))
  const before = [...sorted].reverse().find((d) => d.date < from)
  const stops = [...(before ? [before] : []), ...sorted.filter((d) => d.date >= from && d.date <= to)]
  const route: { name: string; lat: number; lon: number; date: string }[] = []
  for (const d of stops) {
    const last = route[route.length - 1]
    if (!last || last.lat !== d.lat || last.lon !== d.lon) route.push({ name: d.city ?? '?', lat: d.lat!, lon: d.lon!, date: d.date })
  }
  // Only the hops you drive: not one you fly or sail (Sydney → Santiago the day before picking up the car), nor one
  // too far to drive between two nights.
  // A flight or boat on the first night's day counts only when it leaves from there (landing there is how you arrived).
  const near = (p: { lat?: number; lon?: number } | undefined, q: LatLon) => p?.lat != null && p.lon != null && haversineM({ lat: p.lat, lon: p.lon }, q) < 100_000
  const crossed = (a: (typeof route)[number], b: (typeof route)[number]) =>
    items.some(
      (i) =>
        (i.kind === 'flight' || i.kind === 'ferry') &&
        i.status !== 'skipped' &&
        i.date <= b.date &&
        (i.date > a.date || (i.date === a.date && i.to?.lat != null && !near(i.to, a))),
    )
  let m = 0
  const driven = new Set<number>()
  for (let k = 1; k < route.length; k++) {
    const hop = haversineM(route[k - 1], route[k])
    if (hop > MAX_DRIVE_M || crossed(route[k - 1], route[k])) continue
    m += hop * 1.3
    driven.add(k - 1).add(k)
  }
  const carDays = daysBetween(from, to) + 1
  const names = route.filter((_, k) => driven.has(k) || (route.length === 1 && k === 0)).map((r) => r.name)
  return { km: Math.round(m / 1000 + carDays * 30), route: names }
}
