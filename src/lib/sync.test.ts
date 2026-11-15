import { describe, expect, it, vi } from 'vitest'
import { db } from '../db'
import { disableSync, enableSync, syncNow } from './sync'
import { addItem, makeTrip } from '../test/fixtures'

/**
 * A stand-in for server/travel_sync.py: per space, the latest record for each key with a running sequence number; a sync
 * sends changes and gets back what other devices changed since its last sequence (minus what it just sent).
 */
function fakeServer() {
  const spaces = new Map<string, { seq: number; records: Map<string, { seq: number; deleted: boolean; payload?: string }> }>()
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const h = init.headers as Record<string, string>
    const space = h['X-Sync-Space']
    if (!spaces.has(space)) spaces.set(space, { seq: 0, records: new Map() })
    const s = spaces.get(space)!
    const { since, changes } = JSON.parse(init.body as string) as { since: number; changes: { key: string; deleted: boolean; payload?: string }[] }
    const mine = new Set(changes.map((c) => c.key))
    for (const c of changes) s.records.set(c.key, { seq: ++s.seq, deleted: c.deleted, payload: c.payload })
    const records = [...s.records].filter(([k, r]) => r.seq > since && !mine.has(k)).map(([key, r]) => ({ key, ...r }))
    return new Response(JSON.stringify({ seq: s.seq, records }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  return { spaces, fetchMock }
}

/** What a new phone looks like: nothing on it yet. */
async function wipeDevice() {
  await disableSync()
  await Promise.all(db.tables.map((t) => t.clear()))
}

const CODE = 'TRVL-ABCD-EFGH-JKLM-NPQR-STUV'

describe('sync between devices', () => {
  it('a second device gets the trips, and the server only ever sees scrambled data', async () => {
    const server = fakeServer()
    vi.stubGlobal('fetch', server.fetchMock)
    const trip = await makeTrip({ name: 'Secret London weekend' })
    await addItem(trip, { date: trip.startDate, title: 'Tower of London' })
    await enableSync(CODE, 'https://sync.test/')

    const stored = JSON.stringify([...server.spaces.values()].map((s) => [...s.records.values()]))
    expect(stored).not.toContain('Secret London')
    expect(stored).not.toContain('Tower of London')

    await wipeDevice()
    expect(await db.trips.count()).toBe(0)
    await enableSync(CODE, 'https://sync.test/')
    expect((await db.trips.toArray()).map((t) => t.name)).toEqual(['Secret London weekend'])
    expect((await db.items.toArray()).map((i) => i.title)).toEqual(['Tower of London'])
  })

  it('a deletion reaches the other device', async () => {
    const server = fakeServer()
    vi.stubGlobal('fetch', server.fetchMock)
    const trip = await makeTrip()
    const it1 = await addItem(trip, { date: trip.startDate, title: 'Keep me' })
    const it2 = await addItem(trip, { date: trip.startDate, title: 'Delete me' })
    await enableSync(CODE, 'https://sync.test/')
    await db.items.delete(it2.id)
    await syncNow()
    await wipeDevice()
    await enableSync(CODE, 'https://sync.test/')
    expect((await db.items.toArray()).map((i) => i.id)).toEqual([it1.id])
  })

  it('another sync code sees nothing', async () => {
    const server = fakeServer()
    vi.stubGlobal('fetch', server.fetchMock)
    await makeTrip({ name: 'Mine' })
    await enableSync(CODE, 'https://sync.test/')
    await wipeDevice()
    await enableSync('TRVL-ZZZZ-YYYY-XXXX-WWWW-VVVV', 'https://sync.test/')
    expect(await db.trips.count()).toBe(0)
  })
})
