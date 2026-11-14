// "Drive to Yosemite" is you driving: nothing to book. "Pick up rental car at SFO" is a rental: that needs booking.
// Old data and chatbot answers often call both "car", so the title decides.

const RENTAL = /\b(rent|rental|rented|hire|hired|pick[- ]?up|collect|drop[- ]?off|return(?:ing)?|avis|hertz|enterprise|sixt|budget|alamo|europcar|turo)\b/i

export function carKind(title: string): 'car' | 'drive' {
  return RENTAL.test(title) ? 'car' : 'drive'
}
