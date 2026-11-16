// Zero-cost AI: the app writes a prompt, you paste it into any free chatbot (Claude.ai, Gemini, ChatGPT),
// then paste the JSON answer back. Responses are validated before anything is saved.

import { z } from 'zod'
import { planInputs } from './planbasis'
import { trustedPlace } from './cities'
import { db, touchTrip } from '../db'
import type { BudgetCategory, Day, Item, ItemKind, Settings, Trip, TripFocus, TripStyle } from '../types'
import { BUDGET_CATEGORIES, CHECKLIST_CATEGORIES } from '../types'
import { addDays, daysBetween, formatDate } from './dates'
import { country } from './countries'
import { uid } from './ids'
import { carKind } from './drive'
import { isSameItem } from './duplicates'
import { CATEGORY_META, visitMinutes } from './favorites'
import { nightsOf } from './stays'

export const CHATBOTS = [
  { name: 'Claude', url: 'https://claude.ai/new' },
  { name: 'Gemini', url: 'https://gemini.google.com/app' },
  { name: 'ChatGPT', url: 'https://chatgpt.com/' },
]

const KINDS = ['flight', 'train', 'bus', 'car', 'drive', 'ferry', 'taxi', 'stay', 'activity', 'meal', 'walk', 'note'] as const

const num = z.number().optional().catch(undefined)
const str = z.string().optional().catch(undefined)

/** Keeps the valid elements and drops broken ones (e.g. the last, cut-off element of a truncated answer). */
function lenientArray<T extends z.ZodType>(schema: T) {
  return z
    .array(z.unknown())
    .catch([])
    .transform((arr) => arr.flatMap((x) => {
      const r = schema.safeParse(x)
      return r.success ? [r.data as z.output<T>] : []
    }))
}

const AiItem = z.object({
  kind: z.enum(KINDS).catch('activity'),
  title: z.string(),
  time: str,
  endTime: str,
  place: str,
  lat: num,
  lon: num,
  from: str,
  to: str,
  fromLat: num,
  fromLon: num,
  nights: num,
  estCost: num,
  bookAhead: z.boolean().optional().catch(undefined),
  notes: str,
})
type AiItem = z.infer<typeof AiItem>

const AiDay = z.object({
  day: z.number(),
  city: str,
  lat: num,
  lon: num,
  title: str,
  highlights: z.array(z.string()).catch([]), // outline answers
  items: lenientArray(AiItem), // detailed answers
})
type AiDay = z.infer<typeof AiDay>
const ChecklistSuggestion = z.object({ title: z.string(), category: z.enum(CHECKLIST_CATEGORIES).catch('other') })

const AiOption = z.object({
  title: z.string(),
  summary: z.string().catch(''),
  bestFor: z.string().catch(''),
  route: z.array(z.string()).catch([]),
  days: lenientArray(AiDay),
  budget: z.record(z.string(), z.number()).catch({}),
  checklist: lenientArray(ChecklistSuggestion),
  tips: z.array(z.string()).catch([]),
})
export type AiOption = z.infer<typeof AiOption>

const PlanResponse = z.object({ compare: z.string().catch(''), options: lenientArray(AiOption).refine((o) => o.some((x) => x.days.length), 'no complete option') })
const DetailResponse = z.object({ days: lenientArray(AiDay), checklist: lenientArray(ChecklistSuggestion) })
const DayResponse = z.object({ items: lenientArray(AiItem) })
// Booking references and providers are what an imported confirmation is for: they must survive the parsing.
const BookingResponse = z.object({ items: lenientArray(AiItem.extend({ date: z.string(), bookingRef: str, provider: str })) })

/* ------------------------------- Prompts ---------------------------------- */

/** "Starting and ending in X": the AI should plan from there, and skip flights if X is next to the destination. */
function startLine(trip: Trip) {
  const start = trip.startPlace?.name
  if (!start) return undefined
  const end = trip.endPlace?.name
  return end && end !== start
    ? `Starting in ${start} and returning to ${end} (include only the transport actually needed from and to these places; no flights if they are close to the destination)`
    : `Starting and ending in ${start} (include only the transport actually needed from and back to there; no flights if it is close to the destination)`
}

function tripBrief(trip: Trip, settings: Settings) {
  const nights = daysBetween(trip.startDate, trip.endDate)
  const kids = trip.travellers.filter((t) => t.type === 'child')
  const adults = trip.travellers.length - kids.length
  const lines = [
    `Destination(s): ${trip.countryCodes.map((c) => country(c)?.name ?? c).join(', ') || 'open to suggestions'}`,
    trip.cities.length ? `Places I have in mind: ${trip.cities.join(', ')}` : '',
    `Dates: ${trip.startDate} to ${trip.endDate} (${nights + 1} days, ${nights} nights)`,
    `Travellers: ${adults} adult(s)${kids.length ? ` and ${kids.length} child(ren) aged ${kids.map((k) => k.age ?? '?').join(', ')}` : ''}`,
    `Pace: ${PACE_LINE[trip.style]}`,
    `Budget level: ${trip.budgetLevel}`,
    trip.interests.length ? `Interests: ${trip.interests.join(', ')}` : '',
    `Focus: ${FOCUS_LINE[trip.focus ?? 'mix']}`,
    `Getting between places: ${movesLine(trip)}`,
    settings.nationality ? `Nationality: ${country(settings.nationality)?.name ?? settings.nationality}` : '',
    startLine(trip) ?? (settings.homeAirport ? `Departing from: ${settings.homeAirport}` : ''),
    `Currency for costs: ${settings.homeCurrency}`,
    trip.notes ? `Other wishes: ${trip.notes}` : '',
  ]
  return lines.filter(Boolean).join('\n')
}

const PACE_LINE: Record<TripStyle, string> = {
  relaxed: 'relaxed: 1–2 things a day, lots of downtime',
  balanced: 'balanced: a plan each day, with breaks',
  packed: 'packed: see as much as possible, about 9:00–21:00',
  intense:
    'all out: start very early (around 7:00, earlier for a sunrise) and finish late (up to midnight: night views, late openings, evening walks), no rest breaks; long walks and several walks or hikes a day are welcome; skip sit-down lunches and dinners (food on the go) unless the meal is itself a highlight',
}

const FOCUS_LINE: Record<TripFocus, string> = {
  cities: 'mostly cities and towns (sights, museums, food); nature only as day trips',
  mix: 'a balance of cities, countryside, scenic drives and some walks',
  outdoors: 'a road trip: scenic drives, small towns, nature and hikes; keep big cities short (1–2 days)',
}

/**
 * How to travel between places. Every seat on a flight is paid per person, while a rental car (plus fuel) costs the same
 * for the whole group — so unless you chose, groups of 2 or more lean towards driving or trains.
 */
export function movesLine(trip: Trip) {
  const n = trip.travellers.length
  switch (trip.innerFlights ?? 'auto') {
    case 'fly':
      return 'flying between places is fine when it saves time'
    case 'few':
      return 'at most one or two flights inside the trip, only for the longest hops; otherwise drive, train or ferry'
    case 'none':
      return 'no flights inside the trip (only to get there and back): drive, train or ferry between places'
    default:
      return n >= 2
        ? `we are ${n}, so every flight is paid ${n} times while a rental car costs the same for all of us: prefer driving (or a train or ferry) between places when it takes under about 6 hours, and fly only for long hops`
        : 'fly between places only when it saves a lot of time over the train, bus or ferry'
  }
}

const ITEM_SCHEMA = `{ "kind": one of ${KINDS.map((k) => `"${k}"`).join('|')},
  "title": string, "time": "HH:MM" (optional), "endTime": "HH:MM" (optional),
  "place": string (optional), "lat": number, "lon": number (coordinates of the place — for transport, of where it arrives — when known),
  "from": string, "to": string, "fromLat": number, "fromLon": number (transport only: where it leaves from), "nights": number (stays only),
  (use "drive" when we drive ourselves — nothing to book; use "car" only for renting, picking up or returning a rental car),
  "estCost": number (total for the group, in the trip currency), "bookAhead": boolean, "notes": string }
Times are the local clock time where each thing happens. For a journey, "time" is the departure on the local clock where
it leaves and "endTime" the arrival on the local clock where it lands — don't convert between time zones.
A journey's "endTime" is when you arrive; what you do there is its own item, and going back is another journey.
A "note" has no time.`

const CHECKLIST_SCHEMA = `{ "title": string, "category": one of ${CHECKLIST_CATEGORIES.map((c) => `"${c}"`).join('|')} }`

const OPTIONS_SHAPE = `{
  "compare": string (2–3 sentences: how the 3 options differ — route, rhythm, getting around, cost — and who each suits),
  "options": [
    {
      "title": string,
      "bestFor": string (a few words: who or what this option suits best),
      "summary": string (1 sentence),
      "route": [city names in order],
      "days": [ { "day": 1, "city": string, "title": string, "highlights": [string, ...] } ],
      "budget": { "flights": number, "transport": number, "stays": number, "food": number, "activities": number, "other": number },
      "tips": [up to 2 strings]
    }
  ]
}`

/**
 * Step 1: three outlines in one reply, with how they differ first. They're kept compact (1–2 highlights a day) so
 * a free chatbot's reply fits; if it's cut off anyway, the complete options are kept and a follow-up asks for the rest.
 */
export function outlinePrompt(trip: Trip, settings: Settings) {
  const long = daysBetween(trip.startDate, trip.endDate) >= 10
  return `You are an experienced travel planner. I'd like 3 genuinely different itinerary options for this trip (different route, rhythm or focus) as short outlines, all 3 in this reply, starting with a short comparison of how they differ.

${tripBrief(trip, settings)}

Guidelines:
- Respect the pace, the children's ages, the focus and how we want to get between places.
- Each day's city is the town where we sleep that night (a day trip is a highlight, not the city).
- Keep it short: per day only the city, a title and ${long ? '1–2 highlights' : '2 highlights'} of 2–4 words each.
- Budget totals are for the whole group in ${settings.homeCurrency}, using categories: ${BUDGET_CATEGORIES.join(', ')}.
- Write compact JSON: one line per day.

Reply with ONLY a JSON code block, no other text, using exactly this shape:
${OPTIONS_SHAPE}`
}

/** Follow-up in the same chat for the options still missing: after a cut-off reply (shorter), or when fewer than 3 came. */
export function moreOptionsPrompt(n: number, cutOff: boolean) {
  const which = n < 3 ? `options ${n} to 3` : 'option 3'
  return cutOff
    ? `Your reply was cut off${n > 1 ? ` after option ${n - 1}` : ''}. Send ${which} again, shorter: at most 2 highlights per day of 2–4 words each, a 1-sentence summary and at most 2 tips. Same JSON format { "options": [ … ] } with only ${which}, compact (one line per day).`
    : `Now ${which}: clearly different from the previous option${n > 2 ? 's' : ''} (route, rhythm or focus). Same JSON format { "options": [ … ] } with only ${which}, compact (one line per day).`
}

export interface OutlineRound {
  n: number // the first option this reply is for
  prompt: string
  text: string
  error?: string
  truncated?: boolean
  parsed: boolean
}

/**
 * Walks the pasted replies in order. The first should hold all 3 options; when it was cut off (or brought fewer),
 * its complete options are kept — a cut-off one keeps its complete days, marked incomplete — and the next round
 * asks only for the missing ones.
 */
export function outlineRounds(replies: string[], firstPrompt: string, tripDays: number) {
  const rounds: OutlineRound[] = []
  const options: { option: AiOption; incomplete: boolean }[] = []
  let compare = ''
  let n = 1
  let cutOff = false
  for (let i = 0; i <= replies.length && n <= 3; i++) {
    if (i > 0 && !rounds[i - 1].parsed) break
    const text = replies[i] ?? ''
    const round: OutlineRound = { n, prompt: i === 0 ? firstPrompt : moreOptionsPrompt(n, cutOff), text, parsed: false }
    rounds.push(round)
    if (!text.trim()) break
    try {
      const r = parsePlan(text)
      round.parsed = true
      round.truncated = r.truncated
      compare ||= r.compare
      for (const option of r.options) {
        if (n > 3) break
        // Only the option the reply stopped in can be short of days; earlier ones are complete.
        const incomplete = r.truncated && option === r.options[r.options.length - 1] && option.days.length < tripDays
        options[n - 1] = { option, incomplete }
        if (!incomplete) n++
      }
      cutOff = r.truncated
    } catch (e) {
      round.error = (e as Error).message
    }
  }
  return { rounds, options: options.filter(Boolean), compare, done: n > 3 }
}

/** How many places an outline stays in, and on how many days it moves on to the next. */
export function routeShape(o: AiOption) {
  const cities = o.days.map((d) => d.city?.trim().toLowerCase()).filter(Boolean)
  const moves = cities.filter((c, i) => i > 0 && c !== cities[i - 1]).length
  return { places: new Set(cities).size || o.route.length, moves }
}

/** Step 2: the full plan for the chosen option — or, when continuing, only the days still missing. */
export function detailPrompt(trip: Trip, settings: Settings, option: AiOption, days: number[], continuing: boolean) {
  const outline = days
    .map((n) => {
      const d = option.days.find((x) => x.day === n)
      const date = addDays(trip.startDate, n - 1)
      return d
        ? `Day ${n} (${date}) — ${d.city ?? ''}: ${d.title ?? ''}${d.highlights.length ? ` [${d.highlights.join('; ')}]` : ''}`
        : `Day ${n} (${date}) — not in the outline: continue the route sensibly until the trip ends`
    })
    .join('\n')
  const range = days.length > 1 ? `days ${days[0]} to ${days[days.length - 1]}` : `day ${days[0]}`
  // A follow-up repeats the brief, so it also works on its own (asking ChatGPT a few days at a time, without the chat so far).
  const intro = continuing
    ? `Continue the detailed plan for "${option.title}" with ${range} only, in exactly the same JSON format.

${tripBrief(trip, settings)}

Route: ${option.route.join(' → ')}`
    : `Turn the itinerary option "${option.title}" into a detailed day-by-day plan${days.length < option.days.length ? ` — ${range} for now` : ''}.

${tripBrief(trip, settings)}

Route: ${option.route.join(' → ')}`
  return `${intro}

Outline:
${outline}

Guidelines:
- Include transport between places (typical duration in notes) and 2–5 activities or meals per day with times.
- Accommodation: exactly one "stay" item per city, on the day you arrive, with "nights" = the nights spent there (until the day you move on). Never one stay per night, never the same hotel again on a later day, and no "check-in" or "back to the hotel" activities: the stay covers it. Give the stay "place" and coordinates of the area to stay in.
- Each day's "city", "lat" and "lon" are the town where we sleep that night (on a day we fly in, where we land; not home, nor an excursion spot). Day trips and excursions are items of that day.
- Flights: a real schedule for that route (usual departure time and flight time, with the time difference); "time" and "endTime" are never the same. If it lands the next day, say "arrives next day" in notes.
- If the trip starts with a long flight from home, day 1 is the day it leaves: put it on day 1, and plan nothing at the destination until after it has landed (on day 1 or day 2, whichever it is). The flight home goes on the day it leaves.
- Nothing is planned during a journey, and the first thing after landing starts at least 1 hour later (2 hours after a long-haul flight). Before a flight, be at the airport 2 hours ahead (3 for a long-haul one), with the trip to the airport as its own item, and plan nothing in that time.
- A connecting flight is its own item on the day it actually leaves: after a flight that lands past midnight, that's the next day.
- Things at sunrise or sunset start at that place's real sunrise or sunset time on that date; evening and night things are in the evening.
- Visits last a realistic time (a big museum 2–3 hours, a viewpoint 30–60 minutes, a meal 1 hour or more).
- Give real coordinates for each day's town and for places. Every journey needs both ends: "fromLat"/"fromLon" where it leaves and "lat"/"lon" where it arrives — the actual airport, station, port or car-rental office, not the city centre.
- On a travel day, list each step as its own item, in order: getting to the airport or station (drive, taxi…), returning the rental car, the flight or train, then getting from where it arrives to the next place.
- Keep "notes" under 15 words.${continuing ? '' : `
- Checklist: things to do before leaving that are specific to this plan (visas, vaccinations, bookings to make early…).`}
- If the reply would be too long, stop after a complete day and close the JSON properly — I will ask for the rest.

Reply with ONLY a JSON code block, no other text:
{
  "days": [ { "day": number, "city": string, "lat": number, "lon": number, "title": string, "items": [ITEM, ...] } ]${continuing ? '' : `,
  "checklist": [ ${CHECKLIST_SCHEMA} ]`}
}
where ITEM is:
${ITEM_SCHEMA}`
}

/** Things to do in one city, for the favourites board. */
export function cityIdeasPrompt(trip: Trip, settings: Settings, city: string, planned: string[] = []) {
  return `Suggest 20 things to do in ${city} for this trip — a mix of sights, food, experiences, kid-friendly places (if children are coming) and 1–2 day trips.

${tripBrief(trip, settings)}
${planned.length ? `\nAlready in the plan for ${city} (don't suggest these again; suggest other things): ${planned.join('; ')}\n` : ''}
Keep "notes" under 15 words. Give real coordinates when the place is a fixed location.
Reply with ONLY a JSON code block, no other text:
{ "ideas": [ { "name": string, "category": one of ${Object.keys(CATEGORY_META).map((c) => `"${c}"`).join('|')},
  "lat": number, "lon": number, "visitMin": number (typical time spent, in MINUTES — e.g. 90 for an hour and a half), "indoor": boolean, "estCost": number (group total, ${settings.homeCurrency}), "notes": string } ] }`
}

export function replanPrompt(trip: Trip, settings: Settings, day: Day, items: Item[], reason: string, fromTime: string) {
  const list = items
    .map((i) => `- ${i.startTime ?? '--:--'} [${i.kind}] ${i.title}${i.location?.name ? ` @ ${i.location.name}` : ''}${i.status === 'booked' ? ' (BOOKED – keep)' : ''}${i.status === 'done' ? ' (done)' : ''}`)
    .join('\n')
  return `I'm travelling and need to adjust today's plan.

${tripBrief(trip, settings)}

Today: ${formatDate(day.date, { weekday: 'long', day: 'numeric', month: 'long' })}${day.city ? ` in ${day.city}` : ''}. It's now ${fromTime}.
What changed: ${reason}

Current plan for today:
${list || '(nothing planned)'}

Suggest a revised plan for the rest of today (from ${fromTime}). Keep booked items at their times, drop or move what no longer fits, and add alternatives if useful.
Reply with ONLY a JSON code block: { "items": [ITEM, ...] } where ITEM is:
${ITEM_SCHEMA}`
}

export function bookingPrompt(trip: Trip, settings: Settings, text: string) {
  return `Extract the travel bookings from the confirmation(s) below into structured items for my trip (${trip.startDate} to ${trip.endDate}).
Use one item per flight leg / train / stay / rental / ticket. Put the booking reference, seat, terminal etc. in "notes" and the price in "estCost" (in ${settings.homeCurrency} if stated, otherwise the original amount and say the currency in notes).

Reply with ONLY a JSON code block: { "items": [ITEM, ...] } where ITEM is:
${ITEM_SCHEMA.replace('{ "kind"', '{ "date": "YYYY-MM-DD", "kind"').replace('"notes": string }', '"notes": string, "bookingRef": string, "provider": string }')}

Confirmation(s):
"""
${text.trim()}
"""`
}

/* ------------------------------- Parsing ---------------------------------- */

/**
 * Finds the JSON object in a chatbot reply. If the reply was cut off (free chatbots limit reply length),
 * it is closed after the last complete element so everything before the cut can still be used.
 */
function extractJSON(text: string): { value: unknown; truncated: boolean } {
  const fence = text.search(/```(?:json)?/)
  const start = text.indexOf('{', fence >= 0 ? fence : 0)
  if (start < 0) throw new Error('No JSON found in the pasted text.')
  const body = text.slice(start)

  const closers: string[] = []
  let inString = false
  let escaped = false
  let cut = -1
  let cutClosers: string[] = []
  let complete = false
  for (let i = 0; i < body.length && !complete; i++) {
    const c = body[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === '{' || c === '[') closers.push(c === '{' ? '}' : ']')
    else if (c === '}' || c === ']') {
      closers.pop()
      cut = i + 1
      cutClosers = [...closers]
      complete = closers.length === 0
    } else if (c === ',') {
      // Everything before a comma at this level is a complete value.
      cut = i
      cutClosers = [...closers]
    }
  }
  if (cut < 0) throw new Error('The answer stops before any complete part — try asking the chatbot again.')
  const json = body.slice(0, cut) + cutClosers.reverse().join('')
  try {
    return { value: JSON.parse(json), truncated: !complete }
  } catch (e) {
    throw new Error(`The JSON could not be read (${(e as Error).message}). Ask the chatbot to "reply with valid JSON only".`)
  }
}

function friendly<T>(schema: z.ZodType<T>, text: string, normalise: (v: unknown) => unknown = (v) => v): { data: T; truncated: boolean } {
  const { value, truncated } = extractJSON(text)
  const parsed = schema.safeParse(normalise(value))
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new Error(
      truncated
        ? 'The answer was cut off before anything usable. Ask the chatbot to continue, or to keep it shorter.'
        : `The answer doesn't have the expected shape (${first.path.join('.') || 'root'}: ${first.message}).`,
    )
  }
  return { data: parsed.data, truncated }
}

/** Accepts { "compare", "options": [ … ] }, { "option": … } (one per reply, the older prompt) or a bare option. */
export function parsePlan(text: string) {
  const { data, truncated } = friendly(PlanResponse, text, (v) => {
    const o = v as { option?: unknown; options?: unknown; days?: unknown }
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      if (o.options) return o
      if (o.option) return { options: [o.option] }
      if (o.days) return { options: [o] }
    }
    return v
  })
  return { compare: data.compare, options: data.options.filter((o) => o.days.length), truncated }
}
const CityIdea = z.object({
  name: z.string(),
  category: z.string().catch('attraction'),
  lat: num,
  lon: num,
  visitMin: num,
  indoor: z.boolean().optional().catch(undefined),
  estCost: num,
  notes: str,
})
export type CityIdea = z.infer<typeof CityIdea>
export const parseCityIdeas = (text: string) =>
  friendly(z.object({ ideas: lenientArray(CityIdea) }), text).data.ideas.map((i) => ({ ...i, visitMin: visitMinutes(i.visitMin) }))

export function parseDetail(text: string) {
  const { data, truncated } = friendly(DetailResponse, text)
  // In a cut-off reply the last day may be half-written: drop it so the follow-up asks for it again.
  const days = truncated ? data.days.slice(0, -1) : data.days
  return { ...data, days, truncated }
}
export const parseDayItems = (text: string) => friendly(DayResponse, text).data.items
export const parseBookings = (text: string) =>
  friendly(BookingResponse, text).data.items

/** Combines the outline with detailed days from one or more replies; days without detail keep their highlights. */
export function mergeDetail(option: AiOption, replies: { days: AiDay[]; checklist: AiOption['checklist'] }[]): AiOption {
  const detailed = new Map<number, AiDay>()
  for (const r of replies) for (const d of r.days) if (d.items.length) detailed.set(d.day, d)
  const seen = new Set<string>()
  const checklist = [...option.checklist, ...replies.flatMap((r) => r.checklist)].filter((c) => !seen.has(c.title) && !!seen.add(c.title))
  const days = option.days.map((d) => {
    const x = detailed.get(d.day)
    return x ? { ...x, city: x.city ?? d.city, title: x.title ?? d.title, highlights: d.highlights } : d
  })
  // Extra days the detailed answer added beyond the outline.
  for (const [n, d] of detailed) if (!option.days.some((o) => o.day === n)) days.push(d)
  return { ...option, days: days.sort((a, b) => a.day - b.day), checklist }
}

/* -------------------------------- Apply ----------------------------------- */

function toItem(a: AiItem & { bookingRef?: string; provider?: string }, tripId: string, date: string, order: number, currency: string, status: Item['status'] = 'planned'): Item {
  // Chatbots call driving yourself "car" too; the title tells a rental from a drive.
  const kind = (a.kind === 'car' ? carKind(a.title) : a.kind) as ItemKind
  const isTransport = ['flight', 'train', 'bus', 'car', 'drive', 'ferry', 'taxi'].includes(kind)
  return {
    id: uid(),
    tripId,
    date,
    kind,
    title: a.title,
    // A note is for the day, not a moment in it.
    startTime: kind !== 'note' && /^\d{1,2}:\d{2}$/.test(a.time ?? '') ? a.time!.padStart(5, '0') : undefined,
    endTime: kind !== 'note' && /^\d{1,2}:\d{2}$/.test(a.endTime ?? '') ? a.endTime!.padStart(5, '0') : undefined,
    from: isTransport && a.from ? trustedPlace({ name: a.from, lat: a.fromLat, lon: a.fromLon }) : undefined,
    to: isTransport && a.to ? trustedPlace({ name: a.to, lat: a.lat, lon: a.lon }) : undefined,
    location: !isTransport && (a.place || a.lat != null) ? { name: a.place ?? a.title, lat: a.lat, lon: a.lon } : undefined,
    nights: kind === 'stay' ? a.nights ?? 1 : undefined,
    cost: a.estCost ? { amount: a.estCost, currency } : undefined,
    bookingRef: a.bookingRef,
    provider: a.provider,
    status,
    notes: [a.notes, a.bookAhead ? 'Book ahead.' : ''].filter(Boolean).join(' ') || undefined,
    order,
  }
}

/** Drops the "Tips from …" blocks an earlier itinerary idea added to the notes; your own notes stay. */
function withoutPlanTips(notes?: string) {
  return (notes ?? '').split(/\n\n+/).filter((b) => !b.startsWith('Tips from "')).join('\n\n')
}

export async function applyPlan(trip: Trip, option: AiOption, currency: string, replace: boolean) {
  const maxDay = Math.max(...option.days.map((d) => d.day), 1)
  const planEnd = addDays(trip.startDate, maxDay - 1)
  // The end date you chose is kept; an idea only makes the trip longer, and switching idea undoes that.
  const userEnd = trip.userEndDate ?? trip.endDate
  const keepEnd = replace ? userEnd : trip.endDate
  const newEnd = planEnd > keepEnd ? planEnd : keepEnd
  await db.transaction('rw', [db.trips, db.days, db.items, db.checklist, db.favorites], async () => {
    if (replace) {
      await db.items.where('tripId').equals(trip.id).delete()
      await db.days.where('tripId').equals(trip.id).delete()
      // Everything the previous idea brought goes with it: its to-dos (ticked ones stay: that's your progress),
      // and favourites go back to the backup list, since the walks they were on are gone.
      await db.checklist.where('tripId').equals(trip.id).filter((c) => !!c.ruleId?.startsWith('ai:') && !c.done && !c.dismissed).delete()
      const favs = await db.favorites.where('tripId').equals(trip.id).toArray()
      await db.favorites.bulkUpdate(favs.filter((f) => f.date || f.itemId).map((f) => ({ key: f.id, changes: { date: undefined, itemId: undefined, pinned: false } })))
    }
    const budget: Partial<Record<BudgetCategory, number>> = { ...trip.budget }
    // Budget figures the previous idea set (and you haven't changed) go too, unless the new idea sets them again.
    if (replace) for (const c of trip.planBudget ?? []) if (typeof option.budget[c] !== 'number') delete budget[c]
    const fromPlan = BUDGET_CATEGORIES.filter((c) => typeof option.budget[c] === 'number')
    for (const c of fromPlan) budget[c] = option.budget[c]
    await db.trips.update(trip.id, {
      endDate: newEnd,
      userEndDate: newEnd > userEnd ? userEnd : undefined,
      cities: option.route.length ? option.route : trip.cities,
      budget,
      planBudget: replace ? fromPlan : [...new Set([...(trip.planBudget ?? []), ...fromPlan])],
      ...(() => {
        const kept = trip.budgetLines?.filter((l) => typeof option.budget[l.category] !== 'number')
        return { budgetLines: kept?.length ? kept : undefined, budgetBasis: kept?.length ? trip.budgetBasis : undefined }
      })(),
      notes: [replace ? withoutPlanTips(trip.notes) : trip.notes, option.tips.length ? `Tips from "${option.title}":\n• ${option.tips.join('\n• ')}` : ''].filter(Boolean).join('\n\n') || undefined,
    })
    for (const d of option.days) {
      const date = addDays(trip.startDate, d.day - 1)
      await db.days.put({ id: `${trip.id}:${date}`, tripId: trip.id, date, city: d.city, lat: d.lat, lon: d.lon, title: d.title })
      const built = d.items.length ? d.items.map((a, i) => toItem(a, trip.id, date, i, currency)) : d.highlights.map((h, i) => base(trip.id, date, 'activity', h, i, 'idea'))
      // Adding to an existing plan: don't add what the day already has (or what the answer lists twice).
      const already = replace ? [] : await db.items.where({ tripId: trip.id, date }).toArray()
      await db.items.bulkAdd(withoutDuplicates(built, already))
    }
    // Days the answer skipped (or gave no coordinates for) carry on from the previous day's city.
    const last = addDays(trip.startDate, Math.max(maxDay, daysBetween(trip.startDate, trip.endDate) + 1) - 1)
    let prev: Day | undefined
    for (let date = trip.startDate; date <= last; date = addDays(date, 1)) {
      const cur = await db.days.get(`${trip.id}:${date}`)
      if (prev?.city && (!cur?.city || (cur.city === prev.city && cur.lat == null))) {
        await db.days.put({ ...(cur ?? { id: `${trip.id}:${date}`, tripId: trip.id, date }), city: cur?.city ?? prev.city, lat: prev.lat, lon: prev.lon })
      }
      prev = (await db.days.get(`${trip.id}:${date}`)) ?? prev
    }
    // Keyed by title so applying (or re-applying) a plan never duplicates the chatbot's suggestions.
    const have = new Set((await db.checklist.where('tripId').equals(trip.id).toArray()).map((c) => c.ruleId))
    let order = 1000
    await db.checklist.bulkPut(
      option.checklist
        .map((c) => ({ ...c, ruleId: `ai:${c.title.toLowerCase().trim()}` }))
        .filter((c) => !have.has(c.ruleId))
        .map((c) => ({ id: uid(), tripId: trip.id, title: c.title, category: c.category, ruleId: c.ruleId, done: false, order: order++ })),
    )
  })
  // Remember what this itinerary was made for, so a later change of dates, pace… can offer new ideas.
  const now = await db.trips.get(trip.id)
  if (now) await db.trips.update(trip.id, { planBasis: planInputs(now) })
  await touchTrip(trip.id)
}

export async function applyDayReplan(trip: Trip, date: string, keep: Item[], items: AiItem[], currency: string) {
  await db.transaction('rw', [db.items, db.favorites], async () => {
    const existing = await db.items.where({ tripId: trip.id, date }).toArray()
    const keepIds = new Set(keep.map((k) => k.id))
    const gone = existing.filter((e) => !keepIds.has(e.id))
    await db.items.bulkDelete(gone.map((e) => e.id))
    // Wishlist places that were on the replaced part of the day go back to the backups (not straight back onto the day).
    const goneIds = new Set(gone.map((e) => e.id))
    const goneFavs = new Set(gone.map((e) => e.favId).filter(Boolean))
    const favs = (await db.favorites.where('tripId').equals(trip.id).toArray()).filter((f) => goneFavs.has(f.id) || (f.itemId && goneIds.has(f.itemId)))
    await db.favorites.bulkUpdate(favs.map((f) => ({ key: f.id, changes: { date: undefined, pinned: false, itemId: undefined } })))
    // The chatbot repeats the booked items it was told to keep: those are already here.
    const kept = existing.filter((e) => keepIds.has(e.id))
    await db.items.bulkAdd(withoutDuplicates(items.map((a, i) => toItem(a, trip.id, date, keep.length + i, currency, 'planned')), kept))
  })
  await touchTrip(trip.id)
}

/** Items of `fresh` that are not already in `existing` (nor repeated within `fresh`). */
function withoutDuplicates(fresh: Item[], existing: Item[]): Item[] {
  const out: Item[] = []
  for (const n of fresh) if (![...existing, ...out].some((e) => isSameItem(e, n))) out.push(n)
  return out
}

/**
 * Imported bookings turn the matching planned item into a booked one (the flight in your itinerary gets its reference,
 * times and price) instead of being added next to it. Importing the same confirmation twice changes nothing.
 */
export async function applyBookings(trip: Trip, items: ReturnType<typeof parseBookings>, currency: string) {
  await db.transaction('rw', db.items, async () => {
    for (const [i, a] of items.entries()) {
      const fresh = toItem(a, trip.id, a.date, 100 + i, currency, 'booked')
      const sameDay = await db.items.where({ tripId: trip.id, date: fresh.date }).toArray()
      const same = sameDay.filter((x) => isSameItem(x, fresh))
      if (fresh.bookingRef && same.some((x) => x.bookingRef === fresh.bookingRef)) continue // imported before
      let target = same.find((x) => x.status !== 'booked') ?? same[0]
      if (fresh.kind === 'stay') {
        // A hotel booking fills the stay planned for those nights (the placeholder, or the itinerary's), whatever day it
        // starts on, rather than adding a second one; the nights and the address come from the booking.
        const booked = nightsOf(fresh)
        const stays = (await db.items.where('tripId').equals(trip.id).toArray()).filter((x) => x.kind === 'stay' && x.status !== 'booked' && !x.bookingRef)
        const overlap = (x: Item) => nightsOf(x).filter((n) => booked.includes(n)).length
        target = stays.filter((x) => overlap(x) > 0).sort((x, y) => overlap(y) - overlap(x))[0] ?? target
        fresh.hotelSet = true
      }
      if (!target) {
        await db.items.add(fresh)
        continue
      }
      const notes = [target.notes, fresh.notes].filter((n, k, all) => n && all.indexOf(n) === k).join(' · ')
      await db.items.put({
        ...target,
        title: fresh.title || target.title,
        status: 'booked',
        date: fresh.kind === 'stay' ? fresh.date : target.date,
        location: fresh.location?.lat != null ? fresh.location : target.location,
        hotelSet: fresh.hotelSet ?? target.hotelSet,
        startTime: fresh.startTime ?? target.startTime,
        endTime: fresh.endTime ?? target.endTime,
        from: fresh.from ?? target.from,
        to: fresh.to ?? target.to,
        nights: fresh.nights ?? target.nights,
        bookingRef: fresh.bookingRef ?? target.bookingRef,
        provider: fresh.provider ?? target.provider,
        cost: fresh.cost ?? target.cost,
        notes: notes || undefined,
      })
    }
  })
  await touchTrip(trip.id)
}

/** No-AI fallback: spread days across the chosen cities with travel days between them. */
export async function applyTemplate(trip: Trip) {
  const cities = trip.cities.length ? trip.cities : trip.countryCodes.map((c) => country(c)?.capital.name ?? c)
  const days = daysBetween(trip.startDate, trip.endDate) + 1
  const per = Math.max(1, Math.floor(days / cities.length))
  const rows: Item[] = []
  const dayRows: Day[] = []
  for (let d = 0; d < days; d++) {
    const ci = Math.min(cities.length - 1, Math.floor(d / per))
    const city = cities[ci]
    const date = addDays(trip.startDate, d)
    const cap = trip.countryCodes.map((c) => country(c)).find((c) => c?.capital.name === city)?.capital
    dayRows.push({ id: `${trip.id}:${date}`, tripId: trip.id, date, city, lat: cap?.lat, lon: cap?.lon })
    const firstDayInCity = d === 0 || Math.min(cities.length - 1, Math.floor((d - 1) / per)) !== ci
    let o = 0
    if (d === 0) rows.push(base(trip.id, date, 'flight', `Flight to ${city}`, o++, 'idea'))
    else if (firstDayInCity) rows.push(base(trip.id, date, 'train', `${cities[ci - 1]} → ${city}`, o++, 'idea'))
    if (firstDayInCity) {
      const nights = Math.min(per, days - 1 - d) || 1
      rows.push({ ...base(trip.id, date, 'stay', `Stay in ${city}`, o++, 'idea'), nights })
    }
    if (d === days - 1) rows.push(base(trip.id, date, 'flight', `Flight home`, o++, 'idea'))
    else rows.push(base(trip.id, date, 'activity', `Explore ${city}`, o++, 'idea'))
  }
  await db.transaction('rw', [db.days, db.items], async () => {
    await db.days.bulkPut(dayRows)
    // A skeleton on top of an existing plan only adds what is missing.
    const existing = await db.items.where('tripId').equals(trip.id).toArray()
    await db.items.bulkAdd(withoutDuplicates(rows, existing))
  })
  await touchTrip(trip.id)
}

function base(tripId: string, date: string, kind: ItemKind, title: string, order: number, status: Item['status']): Item {
  return { id: uid(), tripId, date, kind, title, status, order }
}
