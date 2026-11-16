import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db'
import { askAllCityIdeas, cityIdeasText, setCityIdeasText } from './cityideas'
import { addItem, makeTrip, SETTINGS } from '../test/fixtures'

/** OpenAI's streamed answer with these ideas. */
function answer(name: string) {
  const text = JSON.stringify({ ideas: [{ name, category: 'food', visitMin: 60 }] })
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
  return new Response(new TextEncoder().encode(body), { status: 200 })
}

describe('ChatGPT ideas for each city, once the itinerary is chosen', () => {
  beforeEach(() => localStorage.setItem('tm-ai-config', JSON.stringify({ mode: 'api', key: 'sk-test', model: 'gpt-4o-mini', tokens: 0 })))

  it('asks for every city on the route that has none yet, telling ChatGPT what is already planned there', async () => {
    const trip = await makeTrip()
    await db.days.bulkPut([
      { id: `${trip.id}:1`, tripId: trip.id, date: '2027-03-10', city: 'London' },
      { id: `${trip.id}:2`, tripId: trip.id, date: '2027-03-11', city: 'Paris' },
      { id: `${trip.id}:3`, tripId: trip.id, date: '2027-03-12', city: 'Rome' },
    ])
    await addItem(trip, { date: '2027-03-11', title: 'Louvre highlights' })
    setCityIdeasText(trip.id, 'London', '{"ideas": []}') // London already has its ideas
    const prompts: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string)
        prompts.push(body.messages.at(-1).content)
        return answer(prompts.length === 1 ? 'Paris bistro' : 'Rome gelato')
      }),
    )
    expect(await askAllCityIdeas(trip.id, SETTINGS)).toEqual({ done: 2, failed: 0 })
    expect(prompts).toHaveLength(2)
    expect(prompts[0]).toMatch(/things to do in Paris/)
    expect(prompts[0]).toMatch(/Already in the plan for Paris .*Louvre highlights/)
    expect(cityIdeasText(trip.id, 'Rome')).toContain('Rome gelato')
    expect(cityIdeasText(trip.id, 'London')).toBe('{"ideas": []}')
  })

  it('does nothing without an API key', async () => {
    localStorage.setItem('tm-ai-config', JSON.stringify({ mode: 'paste', key: '' }))
    const trip = await makeTrip()
    expect(await askAllCityIdeas(trip.id, SETTINGS)).toEqual({ done: 0, failed: 0 })
  })
})
