import { describe, expect, it } from 'vitest'
import { hoursWarning, openingWindow, parseOsmHours } from './hours'

const WED = '2026-12-02'

describe('opening hours', () => {
  it('reads published OpenStreetMap hours for the weekday', () => {
    expect(parseOsmHours('Tu-Su 10:00-18:00', WED)).toEqual({ open: 600, close: 1080, known: true })
    expect(parseOsmHours('Mo-Fr 09:00-17:30; Sa,Su 10:00-16:00', WED)).toEqual({ open: 540, close: 1050, known: true })
    expect(parseOsmHours('Mo-Su 10:00-13:00,14:00-18:00', WED)).toEqual({ open: 600, close: 1080, known: true })
    expect(parseOsmHours('24/7', WED)).toEqual({ open: 0, close: 1440, known: true })
  })

  it('knows when a place is closed that day', () => {
    expect(parseOsmHours('We off', WED)).toBe('closed')
    expect(parseOsmHours('Fr-Tu 10:00-17:00', WED)).toBe('closed') // a range that wraps past the weekend, without Wednesday
  })

  it('guesses 9–17 for sights, no limit for parks, markets, walks and meals', () => {
    expect(openingWindow({ title: 'Tower of London', kind: 'activity' }, WED)).toMatchObject({ open: 540, close: 1020, known: false })
    expect(openingWindow({ title: 'Torre de Belém', kind: 'activity', category: 'monument' }, WED)).toMatchObject({ open: 540 })
    expect(openingWindow({ title: 'Hyde Park', kind: 'activity' }, WED)).toBeUndefined()
    expect(openingWindow({ title: 'Borough Market', kind: 'activity' }, WED)).toBeUndefined()
    expect(openingWindow({ title: 'Statue of someone', kind: 'activity', category: 'monument' }, WED)).toBeUndefined()
    expect(openingWindow({ title: 'Lunch', kind: 'meal' }, WED)).toBeUndefined()
    expect(openingWindow({ title: 'Oxford Street shopping', kind: 'activity' }, WED)).toMatchObject({ open: 600, close: 1140 })
  })

  it('published hours win over the guess', () => {
    expect(openingWindow({ title: 'Jerónimos Monastery', kind: 'activity', hours: 'Tu-Su 09:30-18:00' }, WED)).toEqual({ open: 570, close: 1080, known: true })
  })

  it('warns only when the time falls outside the hours', () => {
    expect(hoursWarning({ title: 'Tower of London', kind: 'activity', startTime: '16:30', endTime: '18:00' }, WED)).toMatch(/may be closed/)
    expect(hoursWarning({ title: 'Tower of London', kind: 'activity', startTime: '10:00', endTime: '12:00' }, WED)).toBeUndefined()
    expect(hoursWarning({ title: 'Hyde Park', kind: 'activity', startTime: '20:00', endTime: '21:00' }, WED)).toBeUndefined()
  })
})
