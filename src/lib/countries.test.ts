import { describe, expect, it } from 'vitest'
import { countryLabel, countryName } from './countries'

describe('country names', () => {
  it('names any country, even one not in the built-in list', () => {
    expect(countryName('IT')).toBe('Italy')
    expect(countryName('SE')).toBe('Sweden')
    expect(countryLabel('NL')).toBe('🇳🇱 Netherlands')
  })
})
