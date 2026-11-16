// Built-in country facts so the app works offline. Hand-curated: always double-check entry rules
// on official sites (the checklist links to them).

export interface Country {
  code: string // ISO alpha-2
  name: string
  citizens: string // as used in Wikipedia "Visa requirements for X citizens"
  currency: string
  plugs: string[]
  voltage: number
  drive: 'left' | 'right'
  emergency: string
  tipping: string
  capital: { name: string; lat: number; lon: number }
  schengen?: boolean
  eu?: boolean
  entryNote?: string // well-known pre-arrival schemes; not exhaustive
}

const SCHENGEN_ETIAS =
  'Schengen area: non-EU visitors are registered by the Entry/Exit System (EES) at the border; visa-exempt visitors will need ETIAS once it is in force — check the official ETIAS site.'

export const COUNTRIES: Country[] = [
  { code: 'FR', name: 'France', citizens: 'French', currency: 'EUR', plugs: ['C', 'E'], voltage: 230, drive: 'right', emergency: '112', tipping: 'Service is included; round up or leave 5–10% for good service.', capital: { name: 'Paris', lat: 48.8566, lon: 2.3522 }, schengen: true, eu: true, entryNote: SCHENGEN_ETIAS },
  { code: 'ES', name: 'Spain', citizens: 'Spanish', currency: 'EUR', plugs: ['C', 'F'], voltage: 230, drive: 'right', emergency: '112', tipping: 'Not expected; rounding up or 5–10% in restaurants is appreciated.', capital: { name: 'Madrid', lat: 40.4168, lon: -3.7038 }, schengen: true, eu: true, entryNote: SCHENGEN_ETIAS },
  { code: 'PT', name: 'Portugal', citizens: 'Portuguese', currency: 'EUR', plugs: ['C', 'F'], voltage: 230, drive: 'right', emergency: '112', tipping: 'Optional; 5–10% in restaurants for good service.', capital: { name: 'Lisbon', lat: 38.7223, lon: -9.1393 }, schengen: true, eu: true, entryNote: SCHENGEN_ETIAS },
  { code: 'IT', name: 'Italy', citizens: 'Italian', currency: 'EUR', plugs: ['C', 'F', 'L'], voltage: 230, drive: 'right', emergency: '112', tipping: '"Coperto" (cover charge) is common; tipping is optional.', capital: { name: 'Rome', lat: 41.9028, lon: 12.4964 }, schengen: true, eu: true, entryNote: SCHENGEN_ETIAS },
  { code: 'DE', name: 'Germany', citizens: 'German', currency: 'EUR', plugs: ['C', 'F'], voltage: 230, drive: 'right', emergency: '112', tipping: 'Round up or add 5–10%, told to the server when paying.', capital: { name: 'Berlin', lat: 52.52, lon: 13.405 }, schengen: true, eu: true, entryNote: SCHENGEN_ETIAS },
  { code: 'NL', name: 'Netherlands', citizens: 'Dutch', currency: 'EUR', plugs: ['C', 'F'], voltage: 230, drive: 'right', emergency: '112', tipping: 'Optional; round up or 5–10%.', capital: { name: 'Amsterdam', lat: 52.3676, lon: 4.9041 }, schengen: true, eu: true, entryNote: SCHENGEN_ETIAS },
  { code: 'BE', name: 'Belgium', citizens: 'Belgian', currency: 'EUR', plugs: ['C', 'E'], voltage: 230, drive: 'right', emergency: '112', tipping: 'Service included; rounding up is common.', capital: { name: 'Brussels', lat: 50.8503, lon: 4.3517 }, schengen: true, eu: true, entryNote: SCHENGEN_ETIAS },
  { code: 'AT', name: 'Austria', citizens: 'Austrian', currency: 'EUR', plugs: ['C', 'F'], voltage: 230, drive: 'right', emergency: '112', tipping: 'Round up or about 10%.', capital: { name: 'Vienna', lat: 48.2082, lon: 16.3738 }, schengen: true, eu: true, entryNote: SCHENGEN_ETIAS },
  { code: 'CH', name: 'Switzerland', citizens: 'Swiss', currency: 'CHF', plugs: ['C', 'J'], voltage: 230, drive: 'right', emergency: '112 (ambulance 144)', tipping: 'Service included; round up for good service.', capital: { name: 'Bern', lat: 46.948, lon: 7.4474 }, schengen: true, entryNote: SCHENGEN_ETIAS },
  { code: 'GR', name: 'Greece', citizens: 'Greek', currency: 'EUR', plugs: ['C', 'F'], voltage: 230, drive: 'right', emergency: '112', tipping: '5–10% in restaurants is customary.', capital: { name: 'Athens', lat: 37.9838, lon: 23.7275 }, schengen: true, eu: true, entryNote: SCHENGEN_ETIAS },
  { code: 'HR', name: 'Croatia', citizens: 'Croatian', currency: 'EUR', plugs: ['C', 'F'], voltage: 230, drive: 'right', emergency: '112', tipping: '10% in restaurants is appreciated.', capital: { name: 'Zagreb', lat: 45.815, lon: 15.9819 }, schengen: true, eu: true, entryNote: SCHENGEN_ETIAS },
  { code: 'MT', name: 'Malta', citizens: 'Maltese', currency: 'EUR', plugs: ['G'], voltage: 230, drive: 'left', emergency: '112', tipping: '5–10% in restaurants if service is not included.', capital: { name: 'Valletta', lat: 35.8989, lon: 14.5146 }, schengen: true, eu: true, entryNote: SCHENGEN_ETIAS },
  { code: 'IE', name: 'Ireland', citizens: 'Irish', currency: 'EUR', plugs: ['G'], voltage: 230, drive: 'left', emergency: '112 / 999', tipping: '10–15% in restaurants with table service.', capital: { name: 'Dublin', lat: 53.3498, lon: -6.2603 }, eu: true },
  { code: 'GB', name: 'United Kingdom', citizens: 'British', currency: 'GBP', plugs: ['G'], voltage: 230, drive: 'left', emergency: '999 / 112', tipping: '10–12.5% in restaurants unless a service charge is added.', capital: { name: 'London', lat: 51.5074, lon: -0.1278 }, entryNote: 'Most visitors who do not need a UK visa (including EU and US citizens) need an Electronic Travel Authorisation (ETA). Irish citizens are exempt.' },
  { code: 'IS', name: 'Iceland', citizens: 'Icelandic', currency: 'ISK', plugs: ['C', 'F'], voltage: 230, drive: 'right', emergency: '112', tipping: 'Not expected; service is included.', capital: { name: 'Reykjavík', lat: 64.1466, lon: -21.9426 }, schengen: true, entryNote: SCHENGEN_ETIAS },
  { code: 'NO', name: 'Norway', citizens: 'Norwegian', currency: 'NOK', plugs: ['C', 'F'], voltage: 230, drive: 'right', emergency: '112 (ambulance 113)', tipping: 'Not expected; rounding up is common.', capital: { name: 'Oslo', lat: 59.9139, lon: 10.7522 }, schengen: true, entryNote: SCHENGEN_ETIAS },
  { code: 'SE', name: 'Sweden', citizens: 'Swedish', currency: 'SEK', plugs: ['C', 'F'], voltage: 230, drive: 'right', emergency: '112', tipping: 'Optional; 5–10% in restaurants.', capital: { name: 'Stockholm', lat: 59.3293, lon: 18.0686 }, schengen: true, eu: true, entryNote: SCHENGEN_ETIAS },
  { code: 'DK', name: 'Denmark', citizens: 'Danish', currency: 'DKK', plugs: ['C', 'F', 'K'], voltage: 230, drive: 'right', emergency: '112', tipping: 'Service included; round up for good service.', capital: { name: 'Copenhagen', lat: 55.6761, lon: 12.5683 }, schengen: true, eu: true, entryNote: SCHENGEN_ETIAS },
  { code: 'CZ', name: 'Czechia', citizens: 'Czech', currency: 'CZK', plugs: ['C', 'E'], voltage: 230, drive: 'right', emergency: '112', tipping: 'Round up or about 10%.', capital: { name: 'Prague', lat: 50.0755, lon: 14.4378 }, schengen: true, eu: true, entryNote: SCHENGEN_ETIAS },
  { code: 'PL', name: 'Poland', citizens: 'Polish', currency: 'PLN', plugs: ['C', 'E'], voltage: 230, drive: 'right', emergency: '112', tipping: 'About 10% in restaurants.', capital: { name: 'Warsaw', lat: 52.2297, lon: 21.0122 }, schengen: true, eu: true, entryNote: SCHENGEN_ETIAS },
  { code: 'HU', name: 'Hungary', citizens: 'Hungarian', currency: 'HUF', plugs: ['C', 'F'], voltage: 230, drive: 'right', emergency: '112', tipping: '10–15% unless a service charge is included.', capital: { name: 'Budapest', lat: 47.4979, lon: 19.0402 }, schengen: true, eu: true, entryNote: SCHENGEN_ETIAS },
  { code: 'TR', name: 'Türkiye', citizens: 'Turkish', currency: 'TRY', plugs: ['C', 'F'], voltage: 230, drive: 'right', emergency: '112', tipping: 'About 10% in restaurants.', capital: { name: 'Ankara', lat: 39.9334, lon: 32.8597 }, entryNote: 'Some nationalities need an e-Visa bought online before travel.' },
  { code: 'MA', name: 'Morocco', citizens: 'Moroccan', currency: 'MAD', plugs: ['C', 'E'], voltage: 220, drive: 'right', emergency: 'Police 19, ambulance 15', tipping: 'Small tips are customary for most services.', capital: { name: 'Rabat', lat: 34.0209, lon: -6.8416 } },
  { code: 'EG', name: 'Egypt', citizens: 'Egyptian', currency: 'EGP', plugs: ['C', 'F'], voltage: 220, drive: 'right', emergency: 'Police 122, ambulance 123', tipping: 'Tipping ("baksheesh") is expected for most services.', capital: { name: 'Cairo', lat: 30.0444, lon: 31.2357 }, entryNote: 'Many nationalities need a visa (e-Visa or on arrival).' },
  { code: 'AE', name: 'United Arab Emirates', citizens: 'Emirati', currency: 'AED', plugs: ['G'], voltage: 230, drive: 'right', emergency: 'Police 999, ambulance 998', tipping: '10–15% if service is not included.', capital: { name: 'Abu Dhabi', lat: 24.4539, lon: 54.3773 } },
  { code: 'KE', name: 'Kenya', citizens: 'Kenyan', currency: 'KES', plugs: ['G'], voltage: 240, drive: 'left', emergency: '999 / 112', tipping: '10% in restaurants; tip safari guides separately.', capital: { name: 'Nairobi', lat: -1.2921, lon: 36.8219 }, entryNote: 'Most visitors need an Electronic Travel Authorisation (eTA) before travel.' },
  { code: 'ZA', name: 'South Africa', citizens: 'South African', currency: 'ZAR', plugs: ['C', 'M', 'N'], voltage: 230, drive: 'left', emergency: '112 (mobile), police 10111', tipping: '10–15% in restaurants; tip car guards and petrol attendants.', capital: { name: 'Pretoria', lat: -25.7479, lon: 28.2293 }, entryNote: 'Children travelling may need extra documents — check official guidance.' },
  { code: 'IN', name: 'India', citizens: 'Indian', currency: 'INR', plugs: ['C', 'D', 'M'], voltage: 230, drive: 'left', emergency: '112', tipping: '5–10% in restaurants; small tips for services.', capital: { name: 'New Delhi', lat: 28.6139, lon: 77.209 }, entryNote: 'Most nationalities need a visa; e-Visa is available for many.' },
  { code: 'LK', name: 'Sri Lanka', citizens: 'Sri Lankan', currency: 'LKR', plugs: ['D', 'G'], voltage: 230, drive: 'left', emergency: 'Police 119, ambulance 1990', tipping: '10% if not included; tip drivers and guides.', capital: { name: 'Colombo', lat: 6.9271, lon: 79.8612 }, entryNote: 'Most visitors need an Electronic Travel Authorisation (ETA) or visa.' },
  { code: 'TH', name: 'Thailand', citizens: 'Thai', currency: 'THB', plugs: ['A', 'B', 'C', 'O'], voltage: 230, drive: 'left', emergency: 'Tourist police 1155, ambulance 1669', tipping: 'Not expected; leaving small change is appreciated.', capital: { name: 'Bangkok', lat: 13.7563, lon: 100.5018 }, entryNote: 'Foreign visitors must fill in the online Thailand Digital Arrival Card (TDAC) before arrival.' },
  { code: 'VN', name: 'Vietnam', citizens: 'Vietnamese', currency: 'VND', plugs: ['A', 'C', 'F'], voltage: 220, drive: 'right', emergency: 'Police 113, ambulance 115', tipping: 'Not expected; appreciated in tourist areas.', capital: { name: 'Hanoi', lat: 21.0278, lon: 105.8342 }, entryNote: 'Many nationalities need an e-Visa; some have visa-free stays.' },
  { code: 'ID', name: 'Indonesia', citizens: 'Indonesian', currency: 'IDR', plugs: ['C', 'F'], voltage: 230, drive: 'left', emergency: '112', tipping: 'Service charge is common; small tips are appreciated.', capital: { name: 'Jakarta', lat: -6.2088, lon: 106.8456 }, entryNote: 'Many nationalities need a visa on arrival (e-VOA available online). Bali charges a tourist levy.' },
  { code: 'SG', name: 'Singapore', citizens: 'Singaporean', currency: 'SGD', plugs: ['G'], voltage: 230, drive: 'left', emergency: 'Police 999, ambulance 995', tipping: 'Not expected; service charge is usually added.', capital: { name: 'Singapore', lat: 1.3521, lon: 103.8198 }, entryNote: 'Submit the SG Arrival Card online within 3 days before arrival.' },
  { code: 'JP', name: 'Japan', citizens: 'Japanese', currency: 'JPY', plugs: ['A', 'B'], voltage: 100, drive: 'left', emergency: 'Police 110, fire/ambulance 119', tipping: 'Not practised — tipping can be refused.', capital: { name: 'Tokyo', lat: 35.6762, lon: 139.6503 }, entryNote: 'Register on Visit Japan Web for faster immigration and customs.' },
  { code: 'KR', name: 'South Korea', citizens: 'South Korean', currency: 'KRW', plugs: ['C', 'F'], voltage: 220, drive: 'right', emergency: 'Police 112, fire/ambulance 119', tipping: 'Not expected.', capital: { name: 'Seoul', lat: 37.5665, lon: 126.978 }, entryNote: 'Visa-exempt visitors may need a K-ETA — check whether your nationality is currently exempted.' },
  { code: 'CN', name: 'China', citizens: 'Chinese', currency: 'CNY', plugs: ['A', 'C', 'I'], voltage: 220, drive: 'right', emergency: 'Police 110, ambulance 120', tipping: 'Not expected.', capital: { name: 'Beijing', lat: 39.9042, lon: 116.4074 }, entryNote: 'Visa rules change often (visa-free schemes exist for some nationalities). Many foreign sites/apps are blocked.' },
  { code: 'AU', name: 'Australia', citizens: 'Australian', currency: 'AUD', plugs: ['I'], voltage: 230, drive: 'left', emergency: '000 (112 from mobiles)', tipping: 'Not expected; 10% for great service.', capital: { name: 'Canberra', lat: -35.2809, lon: 149.13 }, entryNote: 'Almost all visitors need a visa, ETA or eVisitor before travel.' },
  { code: 'NZ', name: 'New Zealand', citizens: 'New Zealand', currency: 'NZD', plugs: ['I'], voltage: 230, drive: 'left', emergency: '111', tipping: 'Not expected.', capital: { name: 'Wellington', lat: -41.2865, lon: 174.7762 }, entryNote: 'Visa-waiver visitors need an NZeTA (plus a tourism levy) before travel.' },
  { code: 'US', name: 'United States', citizens: 'United States', currency: 'USD', plugs: ['A', 'B'], voltage: 120, drive: 'right', emergency: '911', tipping: '18–22% in restaurants; tip for most services.', capital: { name: 'Washington, D.C.', lat: 38.9072, lon: -77.0369 }, entryNote: 'Visa Waiver Program travellers need an approved ESTA before boarding.' },
  { code: 'CA', name: 'Canada', citizens: 'Canadian', currency: 'CAD', plugs: ['A', 'B'], voltage: 120, drive: 'right', emergency: '911', tipping: '15–20% in restaurants.', capital: { name: 'Ottawa', lat: 45.4215, lon: -75.6972 }, entryNote: 'Visa-exempt air travellers (except US citizens) need an eTA.' },
  { code: 'MX', name: 'Mexico', citizens: 'Mexican', currency: 'MXN', plugs: ['A', 'B'], voltage: 127, drive: 'right', emergency: '911', tipping: '10–15% in restaurants.', capital: { name: 'Mexico City', lat: 19.4326, lon: -99.1332 } },
  { code: 'CR', name: 'Costa Rica', citizens: 'Costa Rican', currency: 'CRC', plugs: ['A', 'B'], voltage: 120, drive: 'right', emergency: '911', tipping: '10% service is usually included.', capital: { name: 'San José', lat: 9.9281, lon: -84.0907 } },
  { code: 'CO', name: 'Colombia', citizens: 'Colombian', currency: 'COP', plugs: ['A', 'B'], voltage: 110, drive: 'right', emergency: '123', tipping: 'A 10% "propina" is usually suggested on the bill.', capital: { name: 'Bogotá', lat: 4.711, lon: -74.0721 }, entryNote: 'Fill in the online Check-MIG form before arrival.' },
  { code: 'PE', name: 'Peru', citizens: 'Peruvian', currency: 'PEN', plugs: ['A', 'C'], voltage: 220, drive: 'right', emergency: 'Police 105, ambulance 116', tipping: '10% in restaurants.', capital: { name: 'Lima', lat: -12.0464, lon: -77.0428 } },
  { code: 'BR', name: 'Brazil', citizens: 'Brazilian', currency: 'BRL', plugs: ['C', 'N'], voltage: 220, drive: 'right', emergency: 'Police 190, ambulance 192', tipping: '10% service is usually added.', capital: { name: 'Brasília', lat: -15.8267, lon: -47.9218 }, entryNote: 'Some nationalities (e.g. US, Canada, Australia) need an e-Visa.' },
  { code: 'AR', name: 'Argentina', citizens: 'Argentine', currency: 'ARS', plugs: ['C', 'I'], voltage: 220, drive: 'right', emergency: '911 (ambulance 107)', tipping: '10% in restaurants.', capital: { name: 'Buenos Aires', lat: -34.6037, lon: -58.3816 } },
  { code: 'CL', name: 'Chile', citizens: 'Chilean', currency: 'CLP', plugs: ['C', 'L'], voltage: 220, drive: 'right', emergency: 'Police 133, ambulance 131', tipping: '10% is usually suggested on the bill.', capital: { name: 'Santiago', lat: -33.4489, lon: -70.6693 } },
]

const byCode = new Map(COUNTRIES.map((c) => [c.code, c]))

export function country(code: string | undefined): Country | undefined {
  return code ? byCode.get(code.toUpperCase()) : undefined
}

export function flag(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (ch) => String.fromCodePoint(127397 + ch.charCodeAt(0)))
}

/** A country's name: the built-in list, else the browser's own names (any ISO code), else the code itself. */
export function countryName(code: string): string {
  const c = country(code)
  if (c) return c.name
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}

export function countryLabel(code: string) {
  return /^[A-Za-z]{2}$/.test(code) ? `${flag(code)} ${countryName(code)}` : code
}

export const CURRENCIES = Array.from(new Set(['EUR', 'GBP', 'USD', 'CHF', ...COUNTRIES.map((c) => c.currency)])).sort()

export function visaWikipediaUrl(nationality: string): string | undefined {
  const c = country(nationality)
  if (!c) return undefined
  return `https://en.wikipedia.org/wiki/Visa_requirements_for_${encodeURIComponent(c.citizens.replace(/ /g, '_'))}_citizens`
}

// Official foreign-travel advice for the traveller's own government (top-level pages; these are stable).
const TRAVEL_ADVICE: Record<string, { label: string; url: string }> = {
  GB: { label: 'GOV.UK foreign travel advice', url: 'https://www.gov.uk/foreign-travel-advice' },
  US: { label: 'US State Dept travel advisories', url: 'https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories.html' },
  FR: { label: 'France Diplomatie — Conseils aux voyageurs', url: 'https://www.diplomatie.gouv.fr/fr/conseils-aux-voyageurs/' },
  DE: { label: 'Auswärtiges Amt — Reise- und Sicherheitshinweise', url: 'https://www.auswaertiges-amt.de/de/ReiseUndSicherheit' },
  IE: { label: 'DFA travel advice', url: 'https://www.ireland.ie/en/dfa/overseas-travel/advice/' },
  AU: { label: 'Smartraveller', url: 'https://www.smartraveller.gov.au/destinations' },
  CA: { label: 'Travel.gc.ca advisories', url: 'https://travel.gc.ca/travelling/advisories' },
  NZ: { label: 'SafeTravel', url: 'https://www.safetravel.govt.nz/destinations' },
}

export function travelAdvice(nationality: string) {
  return TRAVEL_ADVICE[nationality.toUpperCase()]
}

export function needsAdapter(home: string, dest: string): { needed: boolean; voltageDiffers: boolean } | undefined {
  const h = country(home)
  const d = country(dest)
  if (!h || !d) return undefined
  // Type C (Europlug) fits C/E/F/J/K/L sockets; that's the only cross-type compatibility worth modelling here.
  const fits = (plug: string, socket: string) =>
    plug === socket || (plug === 'C' && ['E', 'F', 'J', 'K', 'L'].includes(socket)) || (plug === 'E' && socket === 'F') || (plug === 'F' && socket === 'E')
  const needed = !h.plugs.some((p) => d.plugs.some((s) => fits(p, s)))
  return { needed, voltageDiffers: Math.abs(h.voltage - d.voltage) > 40 }
}
