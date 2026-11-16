// A small offline list of well-known cities and their airport codes, so "Sydney" or "SYD" typed into a flight's From/To
// still gives a time zone without a lookup. Coordinates only need to land in the right zone.

// name | airport codes | lat | lon
const RAW = `
Sydney|SYD|-33.87|151.21
Melbourne|MEL|-37.81|144.96
Brisbane|BNE|-27.47|153.03
Perth|PER|-31.95|115.86
Adelaide|ADL|-34.93|138.6
Cairns|CNS|-16.92|145.77
Darwin|DRW|-12.46|130.84
Hobart|HBA|-42.88|147.33
Canberra|CBR|-35.28|149.13
Gold Coast|OOL|-28.0|153.43
Auckland|AKL|-36.85|174.76
Wellington|WLG|-41.29|174.78
Christchurch|CHC|-43.53|172.64
Queenstown|ZQN|-45.03|168.66
Tokyo|NRT,HND|35.68|139.69
Osaka|KIX,ITM|34.69|135.5
Kyoto|UKY|35.01|135.77
Fukuoka|FUK|33.59|130.4
Sapporo|CTS|43.06|141.35
Seoul|ICN,GMP|37.57|126.98
Busan|PUS|35.18|129.08
Beijing|PEK,PKX|39.9|116.4
Shanghai|PVG,SHA|31.23|121.47
Guangzhou|CAN|23.13|113.26
Shenzhen|SZX|22.54|114.06
Chengdu|CTU|30.57|104.07
Hong Kong|HKG|22.32|114.17
Macau|MFM|22.2|113.54
Taipei|TPE|25.03|121.57
Singapore|SIN|1.35|103.82
Kuala Lumpur|KUL|3.14|101.69
Bangkok|BKK,DMK|13.76|100.5
Phuket|HKT|7.88|98.39
Chiang Mai|CNX|18.79|98.98
Hanoi|HAN|21.03|105.85
Ho Chi Minh City|SGN|10.82|106.63
Saigon|SGN|10.82|106.63
Da Nang|DAD|16.05|108.2
Siem Reap|REP|13.36|103.86
Phnom Penh|PNH|11.56|104.93
Jakarta|CGK|-6.21|106.85
Bali|DPS|-8.74|115.17
Denpasar|DPS|-8.74|115.17
Manila|MNL|14.6|120.98
Cebu|CEB|10.32|123.89
Colombo|CMB|6.93|79.86
Kathmandu|KTM|27.72|85.32
Delhi|DEL|28.61|77.21
Mumbai|BOM|19.08|72.88
Bangalore|BLR|12.97|77.59
Chennai|MAA|13.08|80.27
Kolkata|CCU|22.57|88.36
Male|MLE|4.18|73.51
Dubai|DXB,DWC|25.2|55.27
Abu Dhabi|AUH|24.45|54.38
Doha|DOH|25.29|51.53
Riyadh|RUH|24.71|46.68
Muscat|MCT|23.59|58.41
Istanbul|IST,SAW|41.01|28.98
Ankara|ESB|39.93|32.86
Tel Aviv|TLV|32.09|34.78
Jerusalem|JRS|31.77|35.21
Amman|AMM|31.95|35.93
Cairo|CAI|30.04|31.24
Marrakech|RAK|31.63|-8.0
Casablanca|CMN|33.57|-7.59
Tunis|TUN|36.81|10.18
Cape Town|CPT|-33.92|18.42
Johannesburg|JNB|-26.2|28.05
Nairobi|NBO|-1.29|36.82
Addis Ababa|ADD|9.03|38.74
Zanzibar|ZNZ|-6.16|39.2
Lagos|LOS|6.52|3.38
Accra|ACC|5.6|-0.19
Mauritius|MRU|-20.43|57.68
London|LHR,LGW,STN,LTN,LCY|51.51|-0.13
Manchester|MAN|53.48|-2.24
Edinburgh|EDI|55.95|-3.19
Glasgow|GLA|55.86|-4.25
Dublin|DUB|53.35|-6.26
Paris|CDG,ORY|48.86|2.35
Nice|NCE|43.7|7.27
Lyon|LYS|45.76|4.84
Marseille|MRS|43.3|5.37
Amsterdam|AMS|52.37|4.9
Brussels|BRU|50.85|4.35
Frankfurt|FRA|50.11|8.68
Munich|MUC|48.14|11.58
Berlin|BER|52.52|13.4
Hamburg|HAM|53.55|9.99
Zurich|ZRH|47.38|8.54
Geneva|GVA|46.2|6.14
Vienna|VIE|48.21|16.37
Prague|PRG|50.08|14.44
Budapest|BUD|47.5|19.04
Warsaw|WAW|52.23|21.01
Krakow|KRK|50.06|19.94
Copenhagen|CPH|55.68|12.57
Stockholm|ARN|59.33|18.07
Oslo|OSL|59.91|10.75
Helsinki|HEL|60.17|24.94
Reykjavik|KEF,RKV|64.15|-21.94
Madrid|MAD|40.42|-3.7
Barcelona|BCN|41.39|2.17
Seville|SVQ|37.39|-5.98
Malaga|AGP|36.72|-4.42
Lisbon|LIS|38.72|-9.14
Porto|OPO|41.15|-8.61
Faro|FAO|37.02|-7.93
Rome|FCO,CIA|41.9|12.5
Milan|MXP,LIN,BGY|45.46|9.19
Venice|VCE|45.44|12.32
Florence|FLR|43.77|11.26
Naples|NAP|40.85|14.27
Athens|ATH|37.98|23.73
Santorini|JTR|36.39|25.46
Moscow|SVO,DME,VKO|55.76|37.62
St Petersburg|LED|59.93|30.34
Vladivostok|VVO|43.12|131.89
New York|JFK,LGA,EWR|40.71|-74.01
Boston|BOS|42.36|-71.06
Washington|IAD,DCA|38.91|-77.04
Philadelphia|PHL|39.95|-75.17
Miami|MIA|25.76|-80.19
Orlando|MCO|28.54|-81.38
Atlanta|ATL|33.75|-84.39
Chicago|ORD,MDW|41.88|-87.63
Dallas|DFW|32.78|-96.8
Houston|IAH,HOU|29.76|-95.37
Denver|DEN|39.74|-104.99
Las Vegas|LAS|36.17|-115.14
Phoenix|PHX|33.45|-112.07
Los Angeles|LAX|34.05|-118.24
San Diego|SAN|32.72|-117.16
San Francisco|SFO|37.77|-122.42
Yosemite|FAT|37.87|-119.54
Fresno|FAT|36.74|-119.79
Seattle|SEA|47.61|-122.33
Portland|PDX|45.52|-122.68
Salt Lake City|SLC|40.76|-111.89
Anchorage|ANC|61.22|-149.9
Honolulu|HNL|21.31|-157.86
New Orleans|MSY|29.95|-90.07
Nashville|BNA|36.16|-86.78
Toronto|YYZ|43.65|-79.38
Montreal|YUL|45.5|-73.57
Vancouver|YVR|49.28|-123.12
Calgary|YYC|51.05|-114.07
Mexico City|MEX|19.43|-99.13
Cancun|CUN|21.16|-86.85
Havana|HAV|23.11|-82.37
San Jose|SJO|9.93|-84.08
Panama City|PTY|8.98|-79.52
Bogota|BOG|4.71|-74.07
Medellin|MDE|6.24|-75.58
Cartagena|CTG|10.39|-75.48
Lima|LIM|-12.05|-77.04
Cusco|CUZ|-13.53|-71.97
Quito|UIO|-0.18|-78.47
Galapagos|GPS|-0.74|-90.31
La Paz|LPB|-16.5|-68.15
Santiago|SCL|-33.45|-70.67
Punta Arenas|PUQ|-53.16|-70.91
Puerto Natales|PNT|-51.73|-72.5
Puerto Montt|PMC|-41.47|-72.94
Easter Island|IPC|-27.11|-109.35
Buenos Aires|EZE,AEP|-34.6|-58.38
Ushuaia|USH|-54.8|-68.3
Montevideo|MVD|-34.9|-56.16
Rio de Janeiro|GIG,SDU|-22.91|-43.17
Sao Paulo|GRU,CGH|-23.55|-46.63
Salvador|SSA|-12.97|-38.5
Manaus|MAO|-3.12|-60.02
`
export interface City {
  name: string
  codes: string[]
  lat: number
  lon: number
}

export const CITIES: City[] = RAW.trim()
  .split('\n')
  .map((l) => {
    const [name, codes, lat, lon] = l.split('|')
    return { name, codes: codes.split(','), lat: Number(lat), lon: Number(lon) }
  })

const plain = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// The open trip's area (its days' places, its countries' capitals and home). A town that shares its name with a far-away
// well-known city ("Casablanca", a wine valley in Chile, isn't Casablanca in Morocco) isn't taken for it.
let area: { lat: number; lon: number }[] = []
const FAR_KM = 5000
export function setTripArea(points: { lat: number; lon: number }[]) {
  area = points
}
const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(h))
}
/** Is this well-known city anywhere near the trip (always, when no trip is set)? */
export function nearTrip(c: { lat: number; lon: number }, points = area): boolean {
  return !points.length || points.some((p) => km(c, p) < FAR_KM)
}

/** Airport codes written as codes: "(SYD)", "(CDG/ORY)", "SYD → LHR", or on their own — not a capitalised word ("SEA LIFE"). */
function codesIn(text: string) {
  return new Set([
    ...[...text.matchAll(/\(([A-Z]{3}(?:\s*\/\s*[A-Z]{3})*)\)/g)].flatMap((m) => m[1].split(/\s*\/\s*/)),
    ...[...text.matchAll(/\b([A-Z]{3})\s*(?:→|->|–|—)/g)].map((m) => m[1]),
    ...[...text.matchAll(/(?:→|->|–|—)\s*([A-Z]{3})\b/g)].map((m) => m[1]),
    ...(/^\s*[A-Z]{3}\s*$/.test(text) ? [text.trim()] : []),
  ])
}

/** An airport, station or port by its name ("Athens International (ATH)", "Gare de Lyon"), not just a town. */
export function looksLikeHub(name: string): boolean {
  return codesIn(name).size > 0 || /airport|aeropuerto|aeroporto|a[eé]roport|flughafen|lufthavn|\bintl\b|international|station|bahnhof|\bgare\b|estaci[oó]n|terminal|\bport\b|\bpier\b|harbou?r/i.test(name)
}

/**
 * A known city named in free text: "Sydney Airport (SYD)", "Narita, Tokyo", "Gare de Lyon, Paris". The longest city name
 * wins. A city found by its name (not its airport code) counts only when it's near the open trip.
 */
export function cityIn(text?: string, near = area): City | undefined {
  if (!text) return undefined
  const t = ` ${plain(text)} `
  // Airport codes only where they're written as codes: "(SYD)", "(CDG/ORY)", "SYD → LHR", or on their own — not a
  // capitalised word ("SEA LIFE London Aquarium" isn't Seattle).
  const codes = codesIn(text)
  let best: City | undefined
  for (const c of CITIES) {
    const byCode = c.codes.some((k) => codes.has(k))
    const byName = t.includes(` ${plain(c.name)} `) && nearTrip(c, near)
    if ((byCode || byName) && (!best || c.name.length > best.name.length)) best = c
  }
  return best
}

/**
 * Coordinates that contradict the name: a chatbot once gave "Athens International (ATH)" the coordinates of Sydney (it
 * wrote the departure point into the arrival). When the name is a well-known city or airport more than 300 km from the
 * coordinates, the name wins.
 */
export function trustedPlace<P extends { name: string; lat?: number; lon?: number }>(p: P): P {
  // Only an airport, station or port's name is surer than its coordinates: "Casablanca" with coordinates in Chile is the
  // Chilean town, whatever the list of well-known cities says.
  if (p.lat == null || p.lon == null || !looksLikeHub(p.name)) return p
  const c = cityIn(p.name)
  if (!c) return p
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(c.lat - p.lat)
  const dLon = toRad(c.lon - p.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(p.lat)) * Math.cos(toRad(c.lat)) * Math.sin(dLon / 2) ** 2
  const km = 12742 * Math.asin(Math.sqrt(h))
  return km > 300 ? { ...p, lat: c.lat, lon: c.lon } : p
}
