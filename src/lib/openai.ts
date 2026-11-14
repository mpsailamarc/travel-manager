// The optional "ask ChatGPT for me" mode. Without a key the app works as before (copy the prompt, paste the answer).
// The key lives only on this device (localStorage): it is not part of the synced data, backups or shared files,
// and requests go straight from this device to api.openai.com.

import { useSyncExternalStore } from 'react'

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
  localStorage.setItem(STORE, JSON.stringify({ ...getAiConfig(), ...patch }))
  window.dispatchEvent(new Event(EVENT))
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

async function call<T>(path: string, init: RequestInit, key: string, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${key.trim()}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) }, signal: ctrl.signal })
  } catch (e) {
    throw new Error((e as Error).name === 'AbortError' ? 'OpenAI took too long to answer. Try again.' : 'Could not reach OpenAI. Check your internet connection.')
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    let detail = ''
    try {
      detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? ''
    } catch {
      /* no JSON body */
    }
    if (res.status === 401) throw new Error('OpenAI did not accept this key (401). Check that it was copied in full.')
    if (res.status === 429) throw new Error(`OpenAI says: ${detail || 'too many requests, or no credit left'} (429). Check your usage limits and billing at platform.openai.com.`)
    if (res.status === 404) throw new Error(`That model is not available to this key. Pick another model in Settings. ${detail}`.trim())
    throw new Error(`OpenAI error ${res.status}: ${detail || res.statusText}`)
  }
  return (await res.json()) as T
}

/** Sends the conversation to the chosen model and returns its reply (the same text you would have pasted back). */
export async function askAI(messages: ChatMessage[]): Promise<string> {
  const cfg = getAiConfig()
  if (!aiReady(cfg)) throw new Error('Add your OpenAI key in Settings first.')
  type R = { choices?: { message?: { content?: string } }[]; usage?: { total_tokens?: number } }
  const r = await call<R>(
    '/chat/completions',
    {
      method: 'POST',
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'system', content: 'You are a careful travel-planning assistant. Answer exactly in the format the user asks for, with no extra commentary.' }, ...messages],
      }),
    },
    cfg.key,
    180000,
  )
  if (r.usage?.total_tokens) setAiConfig({ tokens: cfg.tokens + r.usage.total_tokens })
  const text = r.choices?.[0]?.message?.content
  if (!text) throw new Error('OpenAI sent back an empty answer. Try again.')
  return text
}

/** Chat models this key can use, smaller ("mini") ones first since they are cheap and plenty for planning. */
export async function listModels(key: string): Promise<string[]> {
  const r = await call<{ data?: { id: string }[] }>('/models', {}, key, 20000)
  const ids = (r.data ?? []).map((m) => m.id).filter((id) => /^(gpt-|o\d|chatgpt-)/.test(id) && !/audio|realtime|image|embed|tts|transcribe|search|moderation|instruct|whisper|dall|codex|vision|preview|\d{4}-\d{2}-\d{2}$/.test(id))
  const rank = (id: string) => (/mini/.test(id) ? 0 : /^gpt-/.test(id) ? 1 : 2)
  return [...new Set(ids)].sort((a, b) => rank(a) - rank(b) || b.localeCompare(a))
}
