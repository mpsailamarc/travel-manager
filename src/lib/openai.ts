// The optional "ask ChatGPT for me" mode. Without a key the app works as before (copy the prompt, paste the answer).
// The key lives only on this device (localStorage): it is not part of the synced data, backups or shared files,
// and requests go straight from this device to api.openai.com.

import { useSyncExternalStore } from 'react'
import { saveLocal } from './storage'
import { setAiName, t } from '../i18n'

export type Provider = 'openai' | 'gemini'

export interface AiConfig {
  mode: 'paste' | 'api'
  provider: Provider // who answers: OpenAI (ChatGPT) or Google (Gemini, which has a free tier)
  key: string // OpenAI
  model: string
  geminiKey: string
  geminiModel: string
  tokens: number // total tokens used from this device, for a rough idea of the bill
}

// Both speak the same chat protocol; only the address, the key and the model differ.
export const PROVIDERS: Record<Provider, { name: string; base: string; defaultModel: string }> = {
  openai: { name: 'ChatGPT', base: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' },
  gemini: { name: 'Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-flash-latest' },
}

/** The provider in use, with its address, key and model. */
export function active(c: AiConfig) {
  return c.provider === 'gemini' ? { provider: c.provider, ...PROVIDERS.gemini, key: c.geminiKey, model: c.geminiModel } : { provider: c.provider, ...PROVIDERS.openai, key: c.key, model: c.model }
}

const STORE = 'tm-ai-config'
const EVENT = 'tm-ai-config'
const DEFAULT: AiConfig = { mode: 'paste', provider: 'openai', key: '', model: 'gpt-4o-mini', geminiKey: '', geminiModel: 'gemini-flash-latest', tokens: 0 }

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
    setAiName(PROVIDERS[cached.provider]?.name ?? 'ChatGPT')
  }
  return cached
}

export function setAiConfig(patch: Partial<AiConfig>) {
  saveLocal(STORE, JSON.stringify({ ...getAiConfig(), ...patch }))
  getAiConfig() // refreshes the name the texts use (ChatGPT / Gemini)
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
export const aiReady = (c: AiConfig) => c.mode === 'api' && active(c).key.trim().length > 0

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// Tried in turn when the chosen Gemini model is overloaded.
const GEMINI_FALLBACKS = ['gemini-flash-latest', 'gemini-flash-lite-latest']

class AiError extends Error {
  constructor(
    message: string,
    readonly retry = false, // worth trying again by itself (network, timeout, OpenAI busy)
  ) {
    super(message)
  }
}

async function failure(res: Response, provider: Provider = 'openai'): Promise<AiError> {
  let detail = ''
  try {
    // OpenAI sends { error }, Google often a list: [{ error }].
    const j = (await res.json()) as { error?: { message?: string } } | { error?: { message?: string } }[]
    detail = (Array.isArray(j) ? j[0] : j)?.error?.message ?? ''
  } catch {
    /* no JSON body */
  }
  if (res.status === 401) return new AiError(t('OpenAI did not accept this key (401). Check that it was copied in full.'))
  if (provider === 'gemini' && (res.status === 503 || res.status === 500)) return new AiError(t('Gemini is busy: {detail}', { detail: detail || res.statusText }), true)
  if (provider === 'gemini' && res.status === 429) return new AiError(t('Gemini says: {detail} (429). The free tier has daily limits: try again later, or pick another model in Settings.', { detail: detail || t('too many requests') }), /per minute|rate/i.test(detail))
  if (res.status === 429 && /quota|billing|credit/i.test(detail)) return new AiError(t('OpenAI says: {detail} (429). Check your usage limits and billing at platform.openai.com.', { detail }))
  if (res.status === 429) return new AiError(t('OpenAI is busy (429): {detail}', { detail: detail || t('too many requests') }), true)
  if (res.status === 404) return new AiError(`${t('That model is not available to this key. Pick another model in Settings.')} ${detail}`.trim())
  return new AiError(t('OpenAI error {status}: {detail}', { status: res.status, detail: detail || res.statusText }), res.status >= 500)
}

async function call<T>(base: string, path: string, init: RequestInit, key: string, timeoutMs: number, provider: Provider = 'openai'): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(base + path, { ...init, headers: { Authorization: `Bearer ${key.trim()}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) }, signal: ctrl.signal })
  } catch (e) {
    throw new AiError((e as Error).name === 'AbortError' ? t('OpenAI took too long to answer. Try again.') : t('Could not reach OpenAI. Check your internet connection.'), true)
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) throw await failure(res, provider)
  return (await res.json()) as T
}

// The answer is streamed: it arrives as it is written, so a long plan never sits on a silent connection (which phones
// and networks drop), and there is no limit on how long the whole answer takes — only on silence: a few minutes for
// the model to start (reasoning models think first), then a minute between pieces.
const FIRST_WORD_MS = 240_000
const GEMINI_FIRST_WORD_MS = 60_000 // Gemini answers within seconds, or it is overloaded: no point in waiting minutes
const BETWEEN_MS = 60_000

async function streamOnce(messages: ChatMessage[], cfg: AiConfig, onProgress?: (chars: number) => void, model?: string): Promise<{ text: string; tokens?: number }> {
  const ctrl = new AbortController()
  let timer = setTimeout(() => ctrl.abort(), cfg.provider === 'gemini' ? GEMINI_FIRST_WORD_MS : FIRST_WORD_MS)
  const alive = (ms: number) => {
    clearTimeout(timer)
    timer = setTimeout(() => ctrl.abort(), ms)
  }
  const ai = { ...active(cfg), ...(model ? { model } : {}) }
  const reasoning = ai.provider === 'openai' && /^(o\d|gpt-5)/.test(ai.model)
  try {
    let res: Response
    try {
      res = await fetch(`${ai.base}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ai.key.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ai.model,
          stream: true,
          ...(ai.provider === 'openai' ? { stream_options: { include_usage: true } } : {}),
          ...(reasoning ? { reasoning_effort: 'low' } : {}), // planning needs little deliberation, and it's much quicker
          messages: [{ role: 'system', content: 'You are a careful travel-planning assistant. Answer exactly in the format the user asks for, with no extra commentary.' }, ...messages],
        }),
        signal: ctrl.signal,
      })
    } catch (e) {
      throw new AiError((e as Error).name === 'AbortError' ? t('OpenAI took too long to start answering.') : t('Could not reach OpenAI. Check your internet connection.'), true)
    }
    if (!res.ok) throw await failure(res, ai.provider)
    if (!res.body) throw new AiError(t('OpenAI sent back an empty answer.'), true)
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
        throw new AiError((e as Error).name === 'AbortError' ? t('OpenAI stopped answering part-way.') : t('The connection to OpenAI dropped part-way.'), true)
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
          const parsed = JSON.parse(data) as Record<string, unknown> | Record<string, unknown>[]
          const j = (Array.isArray(parsed) ? parsed[0] : parsed) as { choices?: { delta?: { content?: string } }[]; usage?: { total_tokens?: number }; error?: { message?: string } }
          if (j.error) throw new AiError(t('OpenAI error: {detail}', { detail: j.error.message ?? t('unknown') }), true)
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
    if (!text.trim()) throw new AiError(t('OpenAI sent back an empty answer.'), true)
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
  if (!aiReady(cfg)) throw new Error(t('Add your OpenAI key in Settings first.'))
  // When Google is busy, the retries go to another model: the one chosen first, then the usual quick ones.
  const models = cfg.provider === 'gemini' ? [...new Set([active(cfg).model, ...GEMINI_FALLBACKS])] : [undefined]
  let last: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, attempt * 3000))
    try {
      const { text, tokens } = await streamOnce(messages, cfg, onProgress, models[Math.min(attempt, models.length - 1)])
      if (tokens) setAiConfig({ tokens: getAiConfig().tokens + tokens })
      return text
    } catch (e) {
      // A fallback model that isn't there for this key says nothing about why the first one failed: that one is reported.
      if (attempt > 0 && e instanceof AiError && !e.retry && last) throw last
      last = e
      if (!(e instanceof AiError) || !e.retry) throw e
    }
  }
  throw new Error(t('{message} It was tried 3 times — check your connection and try again in a moment.', { message: (last as Error).message }))
}

/** Chat models this key can use, smaller ("mini", "flash") ones first since they are cheap, or free, and plenty for planning. */
export async function listModels(key: string, provider: Provider = 'openai'): Promise<string[]> {
  const r = await call<{ data?: { id: string }[] }>(PROVIDERS[provider].base, '/models', {}, key, 20000, provider)
  if (provider === 'gemini') {
    // Google lists every kind of model ("models/gemini-…"): keep the chat ones, the quick ones first.
    const ids = (r.data ?? []).map((m) => m.id.replace(/^models\//, '')).filter((id) => /^gemini-/.test(id) && !/embed|tts|image|live|audio|robotics|computer|vision|aqa|learnlm|\d{3,}$/.test(id))
    const rank = (id: string) => (/latest/.test(id) && /flash/.test(id) && !/lite/.test(id) ? 0 : /flash/.test(id) && !/lite/.test(id) ? 1 : /flash/.test(id) ? 2 : 3)
    return [...new Set(ids)].sort((a, b) => rank(a) - rank(b) || b.localeCompare(a))
  }
  const ids = (r.data ?? []).map((m) => m.id).filter((id) => /^(gpt-|o\d|chatgpt-)/.test(id) && !/audio|realtime|image|embed|tts|transcribe|search|moderation|instruct|whisper|dall|codex|vision|preview|\d{4}-\d{2}-\d{2}$/.test(id))
  const rank = (id: string) => (/mini/.test(id) ? 0 : /^gpt-/.test(id) ? 1 : 2)
  return [...new Set(ids)].sort((a, b) => rank(a) - rank(b) || b.localeCompare(a))
}

if (typeof localStorage !== 'undefined') getAiConfig() // so the texts name the right assistant from the start
