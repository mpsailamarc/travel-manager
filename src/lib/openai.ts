// The optional "ask ChatGPT for me" mode. Without a key the app works as before (copy the prompt, paste the answer).
// The key lives only on this device (localStorage): it is not part of the synced data, backups or shared files,
// and requests go straight from this device to api.openai.com.

import { useSyncExternalStore } from 'react'
import { saveLocal } from './storage'

export interface AiConfig {
  mode: 'paste' | 'api'
  key: string
  model: string
  tokens: number // total tokens used from this device, for a rough idea of the bill
}

const STORE = 'tm-ai-config'
const EVENT = 'tm-ai-config'
const DEFAULT: AiConfig = { mode: 'paste', key: '', model: 'gpt-4o-mini', tokens: 0 }

let cachedRaw: string | null | undefined
let cached: AiConfig = DEFAULT

export function getAiConfig(): AiConfig {
  const raw = localStorage.getItem(STORE)
  if (raw !== cachedRaw) {
    cachedRaw = raw
    try {
      cached = { ...DEFAULT, ...(raw ? JSON.parse(raw) : {}) }
    } catch {
      cached = DEFAULT
    }
  }
  return cached
}

export function setAiConfig(patch: Partial<AiConfig>) {
  saveLocal(STORE, JSON.stringify({ ...getAiConfig(), ...patch }))
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
}

export function useAiConfig(): AiConfig {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(EVENT, cb)
      window.addEventListener('storage', cb)
      return () => {
        window.removeEventListener(EVENT, cb)
        window.removeEventListener('storage', cb)
      }
    },
    getAiConfig,
  )
}

/** True when the app should offer "Ask ChatGPT" buttons. */
export const aiReady = (c: AiConfig) => c.mode === 'api' && c.key.trim().length > 0

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const API = 'https://api.openai.com/v1'

class AiError extends Error {
  constructor(
    message: string,
    readonly retry = false, // worth trying again by itself (network, timeout, OpenAI busy)
  ) {
    super(message)
  }
}

async function failure(res: Response): Promise<AiError> {
  let detail = ''
  try {
    detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? ''
  } catch {
    /* no JSON body */
  }
  if (res.status === 401) return new AiError('OpenAI did not accept this key (401). Check that it was copied in full.')
  if (res.status === 429 && /quota|billing|credit/i.test(detail)) return new AiError(`OpenAI says: ${detail} (429). Check your usage limits and billing at platform.openai.com.`)
  if (res.status === 429) return new AiError(`OpenAI is busy (429): ${detail || 'too many requests'}`, true)
  if (res.status === 404) return new AiError(`That model is not available to this key. Pick another model in Settings. ${detail}`.trim())
  return new AiError(`OpenAI error ${res.status}: ${detail || res.statusText}`, res.status >= 500)
}

async function call<T>(path: string, init: RequestInit, key: string, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${key.trim()}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) }, signal: ctrl.signal })
  } catch (e) {
    throw new AiError((e as Error).name === 'AbortError' ? 'OpenAI took too long to answer. Try again.' : 'Could not reach OpenAI. Check your internet connection.', true)
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) throw await failure(res)
  return (await res.json()) as T
}

// The answer is streamed: it arrives as it is written, so a long plan never sits on a silent connection (which phones
// and networks drop), and there is no limit on how long the whole answer takes — only on silence: a few minutes for
// the model to start (reasoning models think first), then a minute between pieces.
const FIRST_WORD_MS = 240_000
const BETWEEN_MS = 60_000

async function streamOnce(messages: ChatMessage[], cfg: AiConfig, onProgress?: (chars: number) => void): Promise<{ text: string; tokens?: number }> {
  const ctrl = new AbortController()
  let timer = setTimeout(() => ctrl.abort(), FIRST_WORD_MS)
  const alive = (ms: number) => {
    clearTimeout(timer)
    timer = setTimeout(() => ctrl.abort(), ms)
  }
  const reasoning = /^(o\d|gpt-5)/.test(cfg.model)
  try {
    let res: Response
    try {
      res = await fetch(`${API}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.key.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: cfg.model,
          stream: true,
          stream_options: { include_usage: true },
          ...(reasoning ? { reasoning_effort: 'low' } : {}), // planning needs little deliberation, and it's much quicker
          messages: [{ role: 'system', content: 'You are a careful travel-planning assistant. Answer exactly in the format the user asks for, with no extra commentary.' }, ...messages],
        }),
        signal: ctrl.signal,
      })
    } catch (e) {
      throw new AiError((e as Error).name === 'AbortError' ? 'OpenAI took too long to start answering.' : 'Could not reach OpenAI. Check your internet connection.', true)
    }
    if (!res.ok) throw await failure(res)
    if (!res.body) throw new AiError('OpenAI sent back an empty answer.', true)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let text = ''
    let tokens: number | undefined
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await reader.read()
      } catch (e) {
        throw new AiError((e as Error).name === 'AbortError' ? 'OpenAI stopped answering part-way.' : 'The connection to OpenAI dropped part-way.', true)
      }
      if (chunk.done) break
      alive(BETWEEN_MS)
      buffer += decoder.decode(chunk.value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const data = line.startsWith('data:') ? line.slice(5).trim() : ''
        if (!data || data === '[DONE]') continue
        try {
          const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[]; usage?: { total_tokens?: number }; error?: { message?: string } }
          if (j.error) throw new AiError(`OpenAI error: ${j.error.message ?? 'unknown'}`, true)
          const piece = j.choices?.[0]?.delta?.content
          if (piece) {
            text += piece
            onProgress?.(text.length)
          }
          if (j.usage?.total_tokens) tokens = j.usage.total_tokens
        } catch (e) {
          if (e instanceof AiError) throw e
          /* a partial line: ignore */
        }
      }
    }
    if (!text.trim()) throw new AiError('OpenAI sent back an empty answer.', true)
    return { text, tokens }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Sends the conversation to the chosen model and returns its reply (the same text you would have pasted back). A request
 * that fails on the way (dropped connection, OpenAI busy, an empty answer) is tried again by itself, up to 3 times.
 */
export async function askAI(messages: ChatMessage[], onProgress?: (chars: number) => void): Promise<string> {
  const cfg = getAiConfig()
  if (!aiReady(cfg)) throw new Error('Add your OpenAI key in Settings first.')
  let last: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, attempt * 3000))
    try {
      const { text, tokens } = await streamOnce(messages, cfg, onProgress)
      if (tokens) setAiConfig({ tokens: getAiConfig().tokens + tokens })
      return text
    } catch (e) {
      last = e
      if (!(e instanceof AiError) || !e.retry) throw e
    }
  }
  throw new Error(`${(last as Error).message} It was tried 3 times — check your connection and try again in a moment.`)
}

/** Chat models this key can use, smaller ("mini") ones first since they are cheap and plenty for planning. */
export async function listModels(key: string): Promise<string[]> {
  const r = await call<{ data?: { id: string }[] }>('/models', {}, key, 20000)
  const ids = (r.data ?? []).map((m) => m.id).filter((id) => /^(gpt-|o\d|chatgpt-)/.test(id) && !/audio|realtime|image|embed|tts|transcribe|search|moderation|instruct|whisper|dall|codex|vision|preview|\d{4}-\d{2}-\d{2}$/.test(id))
  const rank = (id: string) => (/mini/.test(id) ? 0 : /^gpt-/.test(id) ? 1 : 2)
  return [...new Set(ids)].sort((a, b) => rank(a) - rank(b) || b.localeCompare(a))
}
