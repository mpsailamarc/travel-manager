import { locale } from '../i18n'

export function money(amount: number, currency: string, digits = 0) {
  try {
    return new Intl.NumberFormat(locale(), {
      style: 'currency',
      currency,
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }).format(amount)
  } catch {
    return `${amount.toFixed(digits)} ${currency}`
  }
}

export function distance(m: number) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`
}

export function bytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function plural(n: number, word: string, pluralWord = word + 's') {
  return `${n} ${n === 1 ? word : pluralWord}`
}
