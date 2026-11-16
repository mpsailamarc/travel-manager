// Rule engine that turns a trip (destinations, travellers, itinerary) into a pre-trip checklist.
// Each rule has a stable ruleId so regenerating only adds what's new and never touches your ticks.

import type { ChecklistCategory, ChecklistItem, Day, Item, Settings, Trip } from '../types'
import { db } from '../db'
import { addDays, dateRange, formatDate } from './dates'
import { country, countryName, needsAdapter, travelAdvice, visaWikipediaUrl } from './countries'
import { t, tn } from '../i18n'
import { tripadvisorSearch } from './links'
import { camperNights, isCampsite, stayStretches } from './stays'

export interface ChecklistDraft {
  ruleId: string
  title: string
  category: ChecklistCategory
  dueDate?: string
  notes?: string
  link?: string
  altLink?: string
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
    for (const tr of trip.travellers) {
      add({
        ruleId: `passport:${tr.id}`,
        title: euInternal ? t('ID card or passport valid — {name}', { name: tr.name }) : t('Passport valid until at least {date} — {name}', { date: validUntil, name: tr.name }),
        category: 'documents',
        dueDate: before(60),
        notes: euInternal
          ? t('Within the EU a valid national ID card is usually enough.')
          : t('Many countries require 6 months of validity after you leave, and blank pages. Renewals can take weeks.'),
      })
    }
  }

  for (const d of dests) {
    if (d.code === home) continue
    if (homeC?.eu && d.eu) continue
    add({
      ruleId: `visa:${d.code}`,
      title: t('Check visa / entry requirements for {country}', { country: countryName(d.code) }),
      category: 'documents',
      dueDate: before(45),
      notes: [d.entryNote && t(d.entryNote), t('Confirm on the destination government site — rules change.')].filter(Boolean).join(' '),
      link: (home && visaWikipediaUrl(home)) || `https://en.wikipedia.org/wiki/Visa_policy_of_${encodeURIComponent(d.name.replace(/ /g, '_'))}`,
    })
  }

  if (abroad) {
    const advice = home ? travelAdvice(home) : undefined
    add({
      ruleId: 'advice',
      title: t('Read official travel advice for your destinations'),
      category: 'documents',
      dueDate: before(14),
      notes: advice ? advice.label : t('Use your own government’s foreign travel advice site (safety, entry rules, local laws).'),
      link: advice?.url,
    })
    add({
      ruleId: 'insurance',
      title: t('Buy travel insurance covering everyone (medical + cancellation)'),
      category: 'documents',
      dueDate: before(30),
      notes: t('Buy it soon after booking so cancellation cover starts early.'),
    })
    if (euInternal) {
      add({
        ruleId: 'ehic',
        title: t('European Health Insurance Card (EHIC) for each traveller'),
        category: 'health',
        dueDate: before(21),
        notes: t('Free; gives access to state healthcare in the EU. Not a replacement for travel insurance.'),
      })
    }
  }

  add({
    ruleId: 'doc-copies',
    title: t('Add passport, insurance and booking copies to the Docs tab'),
    category: 'documents',
    dueDate: before(3),
    notes: t('They are stored on this device and open without internet.'),
  })

  if (children.length && adults.length === 1) {
    add({
      ruleId: 'consent-letter',
      title: t('Consent letter from the other parent (travelling with children alone)'),
      category: 'kids',
      dueDate: before(14),
      notes: t('Often asked for at borders, even in Europe. Bring birth certificates if surnames differ.'),
    })
  }

  /* Health */
  const riskier = dests.filter((d) => !LOW_HEALTH_RISK.has(d.code))
  if (riskier.length) {
    add({
      ruleId: 'vaccines',
      title: t('Check vaccines and malaria advice for {countries}', { countries: riskier.map((d) => countryName(d.code)).join(', ') }),
      category: 'health',
      dueDate: before(56),
      notes: t('Some vaccines need several doses — see a travel clinic 6–8 weeks before leaving.'),
      link: 'https://wwwnc.cdc.gov/travel/destinations/list',
    })
  }
  add({ ruleId: 'meds', title: t('Prescription medicines (enough + spare) and a small first-aid kit'), category: 'health', dueDate: before(7) })

  /* Bookings, derived from the itinerary */
  for (const it of items) {
    if (['flight', 'train', 'ferry', 'car'].includes(it.kind) && (it.status === 'idea' || it.status === 'planned')) {
      add({
        ruleId: `book:${it.id}`,
        title: t('Book: {title}', { title: it.title }),
        category: 'bookings',
        dueDate: it.kind === 'flight' ? before(60) : before(21),
        notes: `${formatDate(it.date)}${it.from?.name && it.to?.name ? ` · ${it.from.name} → ${it.to.name}` : ''}`,
      })
    }
    if (it.kind === 'flight') {
      add({
        ruleId: `checkin:${it.id}`,
        title: t('Online check-in: {title}', { title: it.title }),
        category: 'bookings',
        dueDate: addDays(it.date, -1),
        notes: t('Usually opens 24–48 h before departure.'),
      })
    }
    if (it.kind === 'activity' && it.status === 'planned' && it.cost?.amount) {
      add({
        ruleId: `ticket:${it.id}`,
        title: t('Buy tickets: {title}', { title: it.title }),
        category: 'bookings',
        dueDate: addDays(it.date, -7),
        notes: t('Popular sights sell out or have timed entry.'),
        altLink: tripadvisorSearch(it.location?.name ?? it.title, days.find((d) => d.date === it.date)?.city),
      })
    }
    if (it.kind === 'car' || it.kind === 'drive') {
      add({
        ruleId: 'driving',
        title: items.some((i) => i.kind === 'car') ? t('Driving licence (+ international permit if required) and a credit card for the deposit') : t('Driving licence (+ international permit if required)'),
        category: 'documents',
        dueDate: before(21),
        notes: dests.map((d) => t(d.drive === 'left' ? '{country}: drive on the left' : '{country}: drive on the right', { country: countryName(d.code) })).join(' · '),
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
    // Campsites fill up mostly in summer and school holidays: a later reminder, and a map of the campsites around.
    const camp = isCampsite(st)
    add({
      ruleId: `book:${st.id}`,
      title: t('Book: {title}', { title: st.title }),
      category: 'bookings',
      dueDate: before(camp ? 21 : 45),
      notes: [
        city,
        tn(nights, '{date} · {n} night', '{date} · {n} nights', { date: formatDate(st.date) }),
        st.cost?.amount ? t('budgeted {amount} {currency}', { amount: st.cost.amount, currency: st.cost.currency }) : '',
        camp ? t('Popular campsites fill up in summer and school holidays; otherwise you can often just turn up') : '',
      ]
        .filter(Boolean)
        .join(' · '),
      link: st.url ?? (camp ? campsiteSearch(city ?? st.title) : bookingSearch(city ?? st.title, st.date, addDays(st.date, nights), groupAdults, childAges)),
      altLink: camp ? undefined : tripadvisorSearch(st.title, city),
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
      title: t('{what}: {when}', {
        what: city ? t(inVan(run[0]) ? 'Find a campsite in {city}' : 'Find accommodation in {city}', { city }) : t(inVan(run[0]) ? 'Find a campsite' : 'Find accommodation'),
        when: run.length > 1 ? t('{date} → {n} nights', { date: formatDate(run[0]), n: run.length }) : t('{date} (1 night)', { date: formatDate(run[0]) }),
      }),
      category: 'bookings',
      dueDate: before(45),
      notes: t('No accommodation in the plan for these nights yet. Add it on the Plan tab once booked.'),
      link: city ? bookingSearch(city, run[0], addDays(run[run.length - 1], 1), groupAdults, childAges) : undefined,
      altLink: city ? tripadvisorSearch(`${city} hotels`) : undefined,
    })
    run = []
  }
  const inVan = camperNights(trip, items)
  // Only nights that need a bed: not one spent on an overnight flight or train, nor at home.
  const needed = days.length ? new Set(stayStretches(trip, days, items).flatMap((st) => st.nights)) : undefined
  for (const n of dateRange(trip.startDate, addDays(trip.endDate, -1))) {
    if (covered.has(n) || (needed && !needed.has(n))) flush()
    else {
      if (run.length && cityOn(n) !== cityOn(run[0])) flush()
      run.push(n)
    }
  }
  flush()

  /* Money */
  const foreignCurrencies = [...new Set(dests.map((d) => d.currency))].filter((c) => c !== settings.homeCurrency)
  if (foreignCurrencies.length) {
    add({ ruleId: 'cards', title: t('Check card fees abroad; bring two different cards'), category: 'money', dueDate: before(14) })
    add({ ruleId: 'cash', title: t('Some local cash: {currencies}', { currencies: foreignCurrencies.join(', ') }), category: 'money', dueDate: before(2) })
  }
  if (!Object.values(trip.budget).some(Boolean)) {
    add({ ruleId: 'budget', title: t('Set a budget (Budget tab)'), category: 'money' })
  }

  /* Tech */
  if (abroad) {
    add({
      ruleId: 'data',
      title: euInternal ? t('Check your phone plan covers EU roaming') : t('eSIM or roaming plan for {countries}', { countries: dests.map((d) => countryName(d.code)).join(', ') }),
      category: 'tech',
      dueDate: before(7),
    })
  }
  const adapters = new Set<string>()
  for (const d of dests) {
    const a = home ? needsAdapter(home, d.code) : undefined
    if (!a || a.needed || a.voltageDiffers) {
      adapters.add(t('{country}: type {plugs} · {voltage} V', { country: countryName(d.code), plugs: d.plugs.join('/'), voltage: d.voltage }))
    }
  }
  if (adapters.size) {
    add({
      ruleId: 'adapter',
      title: t('Plug adapter(s)'),
      category: 'tech',
      dueDate: before(7),
      notes: [...adapters].join(' · ') + (home ? '' : ' ' + t('(set your nationality in Settings to compare with home)')),
    })
  }
  add({
    ruleId: 'offline',
    title: t('Open each day and walk map once on your phone so they work offline'),
    category: 'tech',
    dueDate: before(1),
  })
  add({
    ruleId: 'offline-maps',
    title: t('Offline maps of {places}', { places: trip.cities.length ? trip.cities.join(', ') : t('your destinations') }),
    category: 'tech',
    dueDate: before(2),
    notes: t('Organic Maps (free, open source, OpenStreetMap data) works fully offline.'),
    link: 'https://organicmaps.app/',
  })
  add({ ruleId: 'power', title: t('Chargers, cables and a power bank'), category: 'packing', dueDate: before(1) })

  /* Kids & packing */
  if (children.length) {
    const ages = children.map((c) => c.age ?? 0)
    add({ ruleId: 'kids-seats', title: t('Seats together on flights/trains for the family'), category: 'kids', dueDate: before(30) })
    add({ ruleId: 'kids-entertainment', title: t('Snacks and entertainment for travel days (downloaded, offline)'), category: 'kids', dueDate: before(1) })
    if (ages.some((a) => a < 4)) {
      add({ ruleId: 'kids-baby', title: t('Stroller / carrier, nappies, wipes, baby food'), category: 'kids', dueDate: before(2) })
    }
    if (items.some((i) => i.kind === 'car' || i.kind === 'drive' || i.kind === 'taxi')) {
      add({ ruleId: 'kids-carseat', title: t('Child car seat / booster (reserve with the rental or bring)'), category: 'kids', dueDate: before(14) })
    }
  }
  add({ ruleId: 'pack', title: t('Pack (check the weather on the Day by day tab a few days before)'), category: 'packing', dueDate: before(1) })

  const seen = new Set<string>()
  return out.filter((d) => !seen.has(d.ruleId) && !!seen.add(d.ruleId))
}

/** Campsites around a place, on the map (no account needed). */
export function campsiteSearch(place: string) {
  return `https://www.google.com/maps/search/${encodeURIComponent(`campsites near ${place}`)}`
}

/** A Booking.com search for the city and dates, pre-filled with the group (a plain link: no account, no tracking). */
export function bookingSearch(city: string, checkin: string, checkout: string, adults: number, childAges: number[]) {
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
    return d && (d.title !== e.title || d.notes !== e.notes || d.link !== e.link || d.altLink !== e.altLink || d.dueDate !== e.dueDate)
  })
  await db.checklist.bulkUpdate(
    changed.map((e) => {
      const d = byRule.get(e.ruleId!)!
      return { key: e.id, changes: { title: d.title, notes: d.notes, link: d.link, altLink: d.altLink, dueDate: d.dueDate } }
    }),
  )
  return { added: fresh.length, removed: gone.length }
}

export const CATEGORY_LABELS: Record<ChecklistCategory, { label: string; emoji: string }> = {
  documents: { label: t('Documents & entry'), emoji: '🛂' },
  health: { label: t('Health'), emoji: '💊' },
  bookings: { label: t('Bookings'), emoji: '🎫' },
  money: { label: t('Money'), emoji: '💳' },
  tech: { label: t('Phone & tech'), emoji: '📱' },
  kids: { label: t('Kids'), emoji: '🧸' },
  packing: { label: t('Packing'), emoji: '🧳' },
  other: { label: t('Other'), emoji: '📌' },
}
