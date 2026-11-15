import { describe, expect, it } from 'vitest'
import { sunClock } from './sun'

const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

describe('sunrise and sunset', () => {
  it('matches published times within a few minutes', () => {
    // London, 21 June 2027: sunrise about 04:43, sunset about 21:21 (BST).
    const london = sunClock('2027-06-21', 51.5074, -0.1278, 'Europe/London')!
    expect(Math.abs(london.rise - (4 * 60 + 43))).toBeLessThan(4)
    expect(Math.abs(london.set - (21 * 60 + 21))).toBeLessThan(4)
    // San Pedro de Atacama, 2 February 2027: sunset about 20:30 (Chile summer time).
    const atacama = sunClock('2027-02-02', -22.9083, -68.1994, 'America/Santiago')!
    expect(hm(atacama.set)).toMatch(/^20:[2-4]/)
  })
})
