// Rule engine that turns a trip (destinations, travellers, itinerary) into a pre-trip checklist.
// Each rule has a stable ruleId so regenerating only adds what's new and never touches your ticks.

import type { ChecklistCategory, ChecklistItem, Day, Item, Settings, Trip } from '../types'
import { db } from '../db'
import { addDays, dateRange, formatDate } from './dates'
import { country, needsAdapter, travelAdvice, visaWikipediaUrl } from './countries'

export interface ChecklistDraft {
  ruleId: string
  title: string
  category: ChecklistCategory
  dueDate?: string
  notes?: string
  link?: string
}

const LOW_HEALTH_RISK = new Set([
  'FR', 'ES', 'PT', 'IT', 'DE', 'NL', 'BE', 'AT', 'CH', 'GR', 'HR', 'MT', 'IE', 'GB', 'IS', 'NO', 'SE', 'DK', 'CZ', 'PL', 'HU',
  'US', 'CA', 'AU', 'NZ', 'JP', 'KR', 'SG', 'AE',
])

export function generateChecklist(trip: Trip, items: Item[], settings: Settings, days: Day[] = []): ChecklistDraft[] {
  const out: ChecklistDraft[] = []
  const add = (d: ChecklistDraft) => out.push(d)
  const before = (days: number) => addDays(trip.startDate, -days)
  const home = settings.nationality
  const homeC = country(home)
  const dests = trip.countryCodes.map((c) => country(c)).filter((c) => !!c)
  const abroad = trip.countryCodes.some((c) => c !== home)
  const euInternal = !!homeC?.eu && dests.every((d) => d.eu)
  const children = trip.travellers.filter((t) => t.type === 'child')
  const adults = trip.travellers.filter((t) => t.type === 'adult')

  /* Documents */
  if (abroad) {
    const validUntil = formatDate(addDays(trip.endDate, 183), { day: 'numeric', month: 'short', year: 'numeric' })
    for (const t of trip.travellers) {
      add({
        ruleId: `passport:${t.id}`,
        title: euInternal ? `ID card or passport valid — ${t.name}` : `Passport valid until at least ${validUntil} — ${t.name}`,
        category: 'documents',
        dueDate: before(60),
        notes: euInternal
          ? 'Within the EU a valid national ID card is usually enough.'
          : 'Many countries require 6 months of validity after you leave, and blank pages. Renewals can take weeks.',
      })
    }
  }

  for (const d of dests) {
    if (d.code === home) continue
    if (homeC?.eu && d.eu) continue
    add({
      ruleId: `visa:${d.code}`,
      title: `Check visa / entry requirements for ${d.name}`,
      category: 'documents',
      dueDate: before(45),
      notes: [d.entryNote, 'Confirm on the destination government site — rules change.'].filter(Boolean).join(' '),
      link: (home && visaWikipediaUrl(home)) || `https://en.wikipedia.org/wiki/Visa_policy_of_${encodeURIComponent(d.name.replace(/ /g, '_'))}`,
    })
  }

  if (abroad) {
    const advice = home ? travelAdvice(home) : undefined
    add({
      ruleId: 'advice',
      title: 'Read official travel advice for your destinations',
      category: 'documents',
      dueDate: before(14),
      notes: advice ? advice.label : 'Use your own government’s foreign travel advice site (safety, entry rules, local laws).',
      link: advice?.url,
    })
    add({
      ruleId: 'insurance',
      title: 'Buy travel insurance covering everyone (medical + cancellation)',
      category: 'documents',
      dueDate: before(30),
      notes: 'Buy it soon after booking so cancellation cover starts early.',
    })
    if (euInternal) {
      add({
        ruleId: 'ehic',
        title: 'European Health Insurance Card (EHIC) for each traveller',
        category: 'health',
        dueDate: before(21),
        notes: 'Free; gives access to state healthcare in the EU. Not a replacement for travel insurance.',
      })
    }
  }

  add({
    ruleId: 'doc-copies',
    title: 'Add passport, insurance and booking copies to the Docs tab',
    category: 'documents',
    dueDate: before(3),
    notes: 'They are stored on this device and open without internet.',
  })

  if (children.length && adults.length === 1) {
    add({
      ruleId: 'consent-letter',
      title: 'Consent letter from the other parent (travelling with children alone)',
      category: 'kids',
      dueDate: before(14),
      notes: 'Often asked for at borders, even in Europe. Bring birth certificates if surnames differ.',
    })
  }

  /* Health */
  const riskier = dests.filter((d) => !LOW_HEALTH_RISK.has(d.code))
  if (riskier.length) {
    add({
      ruleId: 'vaccines',
      title: `Check vaccines and malaria advice for ${riskier.map((d) => d.name).join(', ')}`,
      category: 'health',
      dueDate: before(56),
      notes: 'Some vaccines need several doses — see a travel clinic 6–8 weeks before leaving.',
      link: 'https://wwwnc.cdc.gov/travel/destinations/list',
    })
  }
  add({ ruleId: 'meds', title: 'Prescription medicines (enough + spare) and a small first-aid kit', category: 'health', dueDate: before(7) })

  /* Bookings, derived from the itinerary */
  for (const it of items) {
    if (['flight', 'train', 'ferry', 'car'].includes(it.kind) && (it.status === 'idea' || it.status === 'planned')) {
      add({
        ruleId: `book:${it.id}`,
        title: `Book: ${it.title}`,
        category: 'bookings',
        dueDate: it.kind === 'flight' ? before(60) : before(21),
        notes: `${formatDate(it.date)}${it.from?.name && it.to?.name ? ` · ${it.from.name} → ${it.to.name}` : ''}`,
      })
    }
    if (it.kind === 'flight') {
      add({
        ruleId: `checkin:${it.id}`,
        title: `Online check-in: ${it.title}`,
        category: 'bookings',
        dueDate: addDays(it.date, -1),
        notes: 'Usually opens 24–48 h before departure.',
      })
    }
    if (it.kind === 'activity' && it.status === 'planned' && it.cost?.amount) {
      add({
        ruleId: `ticket:${it.id}`,
        title: `Buy tickets: ${it.title}`,
        category: 'bookings',
        dueDate: addDays(it.date, -7),
        notes: 'Popular sights sell out or have timed entry.',
      })
    }
    if (it.kind === 'car' || it.kind === 'drive') {
      add({
        ruleId: 'driving',
        title: items.some((i) => i.kind === 'car') ? 'Driving licence (+ international permit if required) and a credit card for the deposit' : 'Driving licence (+ international permit if required)',
        category: 'documents',
        dueDate: before(21),
        notes: dests.map((d) => `${d.name}: drive on the ${d.drive}`).join(' · '),
      })
    }
  }

  // One entry per accommodation still to book. Its rule id points at the stay, so ticking it marks the stay as
  // booked (and booking the stay in the plan ticks it).
  const cityOn = (date: string) => days.find((d) => d.date === date)?.city
  const groupAdults = Math.max(1, adults.length)
  const childAges = children.map((k) => k.age ?? 8)
  for (const st of items.filter((i) => i.kind === 'stay' && (i.status === 'idea' || i.status === 'planned'))) {
    const nights = st.nights ?? 1
    const city = cityOn(st.date) ?? st.location?.name
    add({
      ruleId: `book:${st.id}`,
      title: `Book: ${st.title}`,
      category: 'bookings',
      dueDate: before(45),
      notes: [city, `${formatDate(st.date)} · ${nights} night${nights > 1 ? 's' : ''}`, st.cost?.amount ? `budgeted ${st.cost.amount} ${st.cost.currency}` : ''].filter(Boolean).join(' · '),
      link: st.url ?? bookingSearch(city ?? st.title, st.date, addDays(st.date, nights), groupAdults, childAges),
    })
  }

  // Nights with no accommodation at all: one entry per stretch, split when the city changes.
  const covered = new Set<string>()
  for (const s of items.filter((i) => i.kind === 'stay')) {
    for (let n = 0; n < (s.nights ?? 1); n++) covered.add(addDays(s.date, n))
  }
  let run: string[] = []
  const flush = () => {
    if (!run.length) return
    const city = cityOn(run[0])
    add({
      ruleId: `stay-gap:${run[0]}`,
      title: `Find accommodation${city ? ` in ${city}` : ''}: ${formatDate(run[0])}${run.length > 1 ? ` → ${run.length} nights` : ' (1 night)'}`,
      category: 'bookings',
      dueDate: before(45),
      notes: 'No accommodation in the plan for these nights yet. Add it on the Plan tab once booked.',
      link: city ? bookingSearch(city, run[0], addDays(run[run.length - 1], 1), groupAdults, childAges) : undefined,
    })
    run = []
  }
  for (const n of dateRange(trip.startDate, addDays(trip.endDate, -1))) {
    if (covered.has(n)) flush()
    else {
      if (run.length && cityOn(n) !== cityOn(run[0])) flush()
      run.push(n)
    }
  }
  flush()

  /* Money */
  const foreignCurrencies = [...new Set(dests.map((d) => d.currency))].filter((c) => c !== settings.homeCurrency)
  if (foreignCurrencies.length) {
    add({ ruleId: 'cards', title: 'Check card fees abroad; bring two different cards', category: 'money', dueDate: before(14) })
    add({ ruleId: 'cash', title: `Some local cash: ${foreignCurrencies.join(', ')}`, category: 'money', dueDate: before(2) })
  }
  if (!Object.values(trip.budget).some(Boolean)) {
    add({ ruleId: 'budget', title: 'Set a budget (Budget tab)', category: 'money' })
  }

  /* Tech */
  if (abroad) {
    add({
      ruleId: 'data',
      title: euInternal ? 'Check your phone plan covers EU roaming' : `eSIM or roaming plan for ${dests.map((d) => d.name).join(', ')}`,
      category: 'tech',
      dueDate: before(7),
    })
  }
  const adapters = new Set<string>()
  for (const d of dests) {
    const a = home ? needsAdapter(home, d.code) : undefined
    if (!a || a.needed || a.voltageDiffers) {
      adapters.add(`${d.name}: type ${d.plugs.join('/')} · ${d.voltage} V`)
    }
  }
  if (adapters.size) {
    add({
      ruleId: 'adapter',
      title: 'Plug adapter(s)',
      category: 'tech',
      dueDate: before(7),
      notes: [...adapters].join(' · ') + (home ? '' : ' (set your nationality in Settings to compare with home)'),
    })
  }
  add({
    ruleId: 'offline',
    title: 'Open each day and walk map once on your phone so they work offline',
    category: 'tech',
    dueDate: before(1),
  })
  add({
    ruleId: 'offline-maps',
    title: `Offline maps of ${trip.cities.length ? trip.cities.join(', ') : 'your destinations'}`,
    category: 'tech',
    dueDate: before(2),
    notes: 'Organic Maps (free, open source, OpenStreetMap data) works fully offline.',
    link: 'https://organicmaps.app/',
  })
  add({ ruleId: 'power', title: 'Chargers, cables and a power bank', category: 'packing', dueDate: before(1) })

  /* Kids & packing */
  if (children.length) {
    const ages = children.map((c) => c.age ?? 0)
    add({ ruleId: 'kids-seats', title: 'Seats together on flights/trains for the family', category: 'kids', dueDate: before(30) })
    add({ ruleId: 'kids-entertainment', title: 'Snacks and entertainment for travel days (downloaded, offline)', category: 'kids', dueDate: before(1) })
    if (ages.some((a) => a < 4)) {
      add({ ruleId: 'kids-baby', title: 'Stroller / carrier, nappies, wipes, baby food', category: 'kids', dueDate: before(2) })
    }
    if (items.some((i) => i.kind === 'car' || i.kind === 'drive' || i.kind === 'taxi')) {
      add({ ruleId: 'kids-carseat', title: 'Child car seat / booster (reserve with the rental or bring)', category: 'kids', dueDate: before(14) })
    }
  }
  add({ ruleId: 'pack', title: 'Pack (check the weather on the Today tab a few days before)', category: 'packing', dueDate: before(1) })

  const seen = new Set<string>()
  return out.filter((d) => !seen.has(d.ruleId) && !!seen.add(d.ruleId))
}

/** A Booking.com search for the city and dates, pre-filled with the group (a plain link: no account, no tracking). */
function bookingSearch(city: string, checkin: string, checkout: string, adults: number, childAges: number[]) {
  const p = new URLSearchParams({ ss: city, checkin, checkout, group_adults: String(adults), no_rooms: '1', group_children: String(childAges.length) })
  for (const a of childAges) p.append('age', String(a))
  return `https://www.booking.com/searchresults.html?${p}`
}

export function draftsToItems(tripId: string, drafts: ChecklistDraft[], existing: ChecklistItem[]): ChecklistItem[] {
  const have = new Set(existing.map((e) => e.ruleId).filter(Boolean))
  let order = existing.reduce((m, e) => Math.max(m, e.order), 0)
  return drafts
    .filter((d) => !have.has(d.ruleId))
    .map((d) => ({ ...d, id: `${tripId}:${d.ruleId}`, tripId, done: false, order: ++order }))
}

/**
 * Re-run the rules against the current plan: add new suggestions, tick reminders whose item is now booked,
 * and drop unticked ones that no longer apply (item deleted, night now covered). Your own items are never touched.
 */
export async function refreshChecklist(tripId: string, settings: Settings) {
  const trip = await db.trips.get(tripId)
  if (!trip) return { added: 0, removed: 0 }
  const items = await db.items.where('tripId').equals(tripId).toArray()
  const days = await db.days.where('tripId').equals(tripId).toArray()
  const existing = await db.checklist.where('tripId').equals(tripId).toArray()
  const drafts = generateChecklist(trip, items, settings, days)
  const wanted = new Set(drafts.map((d) => d.ruleId))
  const itemIds = new Set(items.map((i) => i.id))
  const stale = existing.filter((e) => e.ruleId && !e.done && !e.ruleId.startsWith('ai:') && !wanted.has(e.ruleId))
  const nowBooked = stale.filter((e) => /^(book|ticket):/.test(e.ruleId!) && itemIds.has(e.ruleId!.split(':')[1]))
  const gone = stale.filter((e) => !nowBooked.includes(e))
  await db.checklist.bulkUpdate(nowBooked.map((e) => ({ key: e.id, changes: { done: true } })))
  await db.checklist.bulkDelete(gone.map((e) => e.id))
  const fresh = draftsToItems(tripId, drafts, existing.filter((e) => !gone.includes(e)))
  await db.checklist.bulkPut(fresh)
  // Keep open suggestions in step with the plan (a stay moved to another date, a renamed train…).
  const byRule = new Map(drafts.map((d) => [d.ruleId, d]))
  const changed = existing.filter((e) => {
    const d = e.ruleId && !e.done && !e.dismissed && !e.locked ? byRule.get(e.ruleId) : undefined
    return d && (d.title !== e.title || d.notes !== e.notes || d.link !== e.link || d.dueDate !== e.dueDate)
  })
  await db.checklist.bulkUpdate(
    changed.map((e) => {
      const d = byRule.get(e.ruleId!)!
      return { key: e.id, changes: { title: d.title, notes: d.notes, link: d.link, dueDate: d.dueDate } }
    }),
  )
  return { added: fresh.length, removed: gone.length }
}

export const CATEGORY_LABELS: Record<ChecklistCategory, { label: string; emoji: string }> = {
  documents: { label: 'Documents & entry', emoji: '🛂' },
  health: { label: 'Health', emoji: '💊' },
  bookings: { label: 'Bookings', emoji: '🎫' },
  money: { label: 'Money', emoji: '💳' },
  tech: { label: 'Phone & tech', emoji: '📱' },
  kids: { label: 'Kids', emoji: '🧸' },
  packing: { label: 'Packing', emoji: '🧳' },
  other: { label: 'Other', emoji: '📌' },
}
