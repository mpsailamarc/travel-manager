import { beforeEach, describe, expect, it, vi } from 'vitest'
import { askAI } from './openai'

/** A streamed answer, as OpenAI sends it: server-sent events, cut into arbitrary pieces. */
function streamed(pieces: string[], usage = 42) {
  const events = [...pieces.map((p) => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`), `data: ${JSON.stringify({ choices: [], usage: { total_tokens: usage } })}\n\n`, 'data: [DONE]\n\n'].join('')
  const bytes = new TextEncoder().encode(events)
  const cut = [bytes.slice(0, 17), bytes.slice(17, 60), bytes.slice(60)] // pieces don't line up with events
  return new Response(new ReadableStream({ start(c) { for (const b of cut) c.enqueue(b); c.close() } }), { status: 200 })
}

describe('asking ChatGPT', () => {
  beforeEach(() => localStorage.setItem('tm-ai-config', JSON.stringify({ mode: 'api', key: 'sk-test', model: 'gpt-4o-mini', tokens: 0 })))

  it('reads a streamed answer and reports progress as it arrives', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamed(['{"days": ', '[1, 2', ']}'])))
    const progress: number[] = []
    expect(await askAI([{ role: 'user', content: 'plan' }], (n) => progress.push(n))).toBe('{"days": [1, 2]}')
    expect(progress.at(-1)).toBe(16)
    expect(JSON.parse(localStorage.getItem('tm-ai-config')!).tokens).toBe(42)
  })

  it('tries again by itself when the connection drops or OpenAI is busy', async () => {
    vi.useFakeTimers()
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Rate limit reached' } }), { status: 429 }))
      .mockResolvedValueOnce(streamed(['ok']))
    vi.stubGlobal('fetch', fetch)
    const answer = askAI([{ role: 'user', content: 'plan' }])
    await vi.runAllTimersAsync()
    expect(await answer).toBe('ok')
    expect(fetch).toHaveBeenCalledTimes(3)
    vi.useRealTimers()
  })

  it('does not retry a key OpenAI refuses', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 }))
    vi.stubGlobal('fetch', fetch)
    await expect(askAI([{ role: 'user', content: 'plan' }])).rejects.toThrow(/did not accept this key/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
