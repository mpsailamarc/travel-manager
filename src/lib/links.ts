// Plain links to Tripadvisor's own search: no account, no key, nothing sent to Tripadvisor until you tap one.
// On a phone with the Tripadvisor app installed they may open there.

/** Search for a place; the city is added unless the name already says it ("Baixa, Lisbon" + Lisbon stays as is). */
export function tripadvisorSearch(name: string, city?: string) {
  const n = name.trim()
  const q = city && !n.toLowerCase().includes(city.toLowerCase()) ? `${n} ${city}` : n
  return `https://www.tripadvisor.com/Search?q=${encodeURIComponent(q)}`
}
