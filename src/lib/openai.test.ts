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

describe('asking Gemini (the free tier)', () => {
  beforeEach(() => localStorage.setItem('tm-ai-config', JSON.stringify({ mode: 'api', provider: 'gemini', key: 'sk-not-used', geminiKey: 'AIza-test', geminiModel: 'gemini-flash-latest', tokens: 0 })))

  it('sends the request to Google with the Gemini key and model, without OpenAI-only options', async () => {
    const fetch = vi.fn(async () => streamed(['ok']))
    vi.stubGlobal('fetch', fetch)
    expect(await askAI([{ role: 'user', content: 'plan' }])).toBe('ok')
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer AIza-test')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('gemini-flash-latest')
    expect(body.stream_options).toBeUndefined()
    expect(body.reasoning_effort).toBeUndefined()
  })

  it('is ready only with the Gemini key, and the texts name Gemini', async () => {
    const { aiReady, getAiConfig, setAiConfig } = await import('./openai')
    const { t } = await import('../i18n')
    expect(aiReady(getAiConfig())).toBe(true)
    expect(t('✨ Ask ChatGPT')).toBe('✨ Ask Gemini')
    setAiConfig({ geminiKey: '' })
    expect(aiReady(getAiConfig())).toBe(false)
    setAiConfig({ provider: 'openai' })
    expect(t('✨ Ask ChatGPT')).toBe('✨ Ask ChatGPT')
  })

  it('lists the chat models of Google, the quick ones first', async () => {
    const { listModels } = await import('./openai')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'models/gemini-2.5-pro' }, { id: 'models/text-embedding-004' }, { id: 'models/gemini-flash-latest' }, { id: 'models/gemini-2.5-flash-lite' }, { id: 'models/gemini-2.5-flash-image' }] }))))
    expect(await listModels('AIza-test', 'gemini')).toEqual(['gemini-flash-latest', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'])
  })
})

