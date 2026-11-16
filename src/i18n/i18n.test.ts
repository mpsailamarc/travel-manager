import { describe, expect, it } from 'vitest'
import { FR, langFromUrl, t, tn, useLangForTests } from './index'

describe('language', () => {
  it('reads ?lang= in the address, before or inside the #', () => {
    expect(langFromUrl('https://x.github.io/travel-manager/?lang=fr')).toBe('fr')
    expect(langFromUrl('https://x.github.io/travel-manager/#/trip/a/plan?lang=FR')).toBe('fr')
    expect(langFromUrl('https://x.github.io/travel-manager/?a=1&lang=en#/')).toBe('en')
    expect(langFromUrl('https://x.github.io/travel-manager/?lang=de')).toBeUndefined()
    expect(langFromUrl('https://x.github.io/travel-manager/')).toBeUndefined()
  })

  it('shows English as it is, French from the dictionary, and fills in values', () => {
    useLangForTests('en')
    expect(t('Language')).toBe('Language')
    expect(t('{n} nights in {city}', { n: 3, city: 'Rome' })).toBe('3 nights in Rome')
    useLangForTests('fr')
    expect(t('Language')).toBe('Langue')
    expect(t('Not translated yet {x}', { x: 1 })).toBe('Not translated yet 1')
    useLangForTests('en')
  })

  it('counts singular and plural: French has 0 and 1 as singular', () => {
    useLangForTests('fr')
    expect(tn(0, '{n} night', '{n} nights')).toBe('0 night')
    expect(tn(2, '{n} night', '{n} nights')).toBe('2 nights')
    useLangForTests('en')
    expect(tn(0, '{n} night', '{n} nights')).toBe('0 nights')
    expect(tn(1, '{n} night', '{n} nights')).toBe('1 night')
  })

  it('every French text keeps the {values} of its English text, and none is empty', () => {
    for (const [en, fr] of Object.entries(FR)) {
      expect(fr.trim(), en).not.toBe('')
      const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join()
      expect(vars(fr), `values of: ${en}`).toBe(vars(en))
    }
  })
})
