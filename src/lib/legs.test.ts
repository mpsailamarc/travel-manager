import { describe, expect, it } from 'vitest'
import { planLeg } from './legs'
import { LONDON } from '../test/fixtures'

// No network in tests: walking and taxi fall back to straight-line distance × 1.3, as the app does offline.
describe('getting between places', () => {
  it('walks short hops whatever the preference', async () => {
    const l = await planLeg(LONDON.hotel, LONDON.gallery, 'taxi', 15, 4.5)
    expect(l.mode).toBe('walk')
    expect(l.minutes).toBeLessThan(15)
  })

  it('takes public transport or a taxi for longer ones, as asked', async () => {
    expect((await planLeg(LONDON.hotel, LONDON.tower, 'transit', 15, 4.5)).mode).toBe('transit')
    expect((await planLeg(LONDON.hotel, LONDON.tower, 'taxi', 15, 4.5)).mode).toBe('taxi')
    expect((await planLeg(LONDON.hotel, LONDON.tower, 'walk', 15, 4.5)).mode).toBe('walk')
  })

  it('"whatever is quickest" picks the fastest of the three', async () => {
    const l = await planLeg(LONDON.hotel, LONDON.heathrow, 'fastest', 15, 4.5)
    const options = await Promise.all((['walk', 'transit', 'taxi'] as const).map((m) => planLeg(LONDON.hotel, LONDON.heathrow, m, 0, 4.5)))
    expect(l.minutes).toBe(Math.min(...options.map((o) => o.minutes)))
  })

  it('marks public transport as an estimate', async () => {
    expect((await planLeg(LONDON.hotel, LONDON.tower, 'transit', 15, 4.5)).estimated).toBe(true)
  })
})
