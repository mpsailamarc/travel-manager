// crypto.randomUUID only exists in secure contexts; fall back when served over plain http on a LAN.
export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    try {
      return crypto.randomUUID()
    } catch {
      /* fall through */
    }
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}
