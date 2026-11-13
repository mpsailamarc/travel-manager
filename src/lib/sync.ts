// Automatic sync between your devices through your own small server (see server/travel_sync.py).
//
// - Everything is encrypted on the device (AES-GCM, key derived from the sync code) before it is sent:
//   the server only stores scrambled records keyed by "table/id".
// - Local changes are found by comparing each record's hash with its hash at the last sync, so no change
//   tracking is needed anywhere else in the app. Deleted records become tombstones.
// - Conflicts: if the same record changed on two devices between syncs, the device that syncs last wins.
// - Documents (passport scans…) and settings stay on each device.

import { useEffect, useState } from 'react'
import { db } from '../db'

const TABLES = ['trips', 'days', 'items', 'checklist', 'expenses', 'favorites'] as const
type SyncTable = (typeof TABLES)[number]

const CONFIG_KEY = 'tm-sync'
const DEBOUNCE_MS = 4000
const INTERVAL_MS = 60_000

export interface SyncConfig {
  code: string
  server: string // API base URL, ends with "/"
  lastSeq: number
  lastSync?: number
}

export type SyncStatus =
  | { state: 'off' }
  | { state: 'idle'; lastSync?: number }
  | { state: 'syncing'; lastSync?: number }
  | { state: 'error'; message: string; lastSync?: number }
  | { state: 'offline'; lastSync?: number }

/* ------------------------------- Config ----------------------------------- */

export function defaultServer() {
  // Published builds name the sync server (see .env.production); otherwise it sits next to the app: /travel/ → /travel-api/
  return import.meta.env.VITE_SYNC_SERVER || new URL('../travel-api/', location.href).href
}

export function getConfig(): SyncConfig | undefined {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    return raw ? (JSON.parse(raw) as SyncConfig) : undefined
  } catch {
    return undefined
  }
}

function saveConfig(c: SyncConfig | undefined) {
  if (c) localStorage.setItem(CONFIG_KEY, JSON.stringify(c))
  else localStorage.removeItem(CONFIG_KEY)
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O, 1/I

/** A new random sync code, e.g. "TRVL-7KQ3-M9XD-2HPA-WC4N-…" (≈ 120 bits). */
export function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
  return 'TRVL-' + chars.match(/.{4}/g)!.join('-')
}

export const normaliseCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '')

/* ------------------------------- Crypto ----------------------------------- */

const enc = new TextEncoder()
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)))

interface Keys {
  space: string
  token: string
  aes: CryptoKey
}

let keyCache: { code: string; keys: Promise<Keys> } | undefined

function keysFor(code: string): Promise<Keys> {
  if (keyCache?.code === code) return keyCache.keys
  const keys = (async () => {
    const c = normaliseCode(code)
    const space = (await sha256('tm-space:' + c)).slice(0, 32)
    const token = await sha256('tm-token:' + c)
    const base = await crypto.subtle.importKey('raw', enc.encode(c), 'PBKDF2', false, ['deriveKey'])
    const aes = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: enc.encode('tm-salt:' + space), iterations: 150_000, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
    return { space, token, aes }
  })()
  keyCache = { code, keys }
  return keys
}

function toB64(bytes: Uint8Array) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function fromB64(b64: string) {
  return Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))
}

async function encrypt(aes: CryptoKey, json: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, enc.encode(json)))
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv)
  out.set(ct, iv.length)
  return toB64(out)
}

async function decrypt(aes: CryptoKey, payload: string): Promise<unknown> {
  const bytes = fromB64(payload)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, aes, bytes.subarray(12))
  return JSON.parse(new TextDecoder().decode(plain))
}

/** Fast non-cryptographic hash, only used to notice that a record changed. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36) + ':' + s.length.toString(36)
}

/* ------------------------------- Status ----------------------------------- */

let status: SyncStatus = getConfig() ? { state: 'idle', lastSync: getConfig()?.lastSync } : { state: 'off' }
const listeners = new Set<(s: SyncStatus) => void>()

function setStatus(s: SyncStatus) {
  status = s
  listeners.forEach((l) => l(s))
}

export function useSyncStatus() {
  const [s, set] = useState(status)
  useEffect(() => {
    listeners.add(set)
    set(status)
    return () => {
      listeners.delete(set)
    }
  }, [])
  return s
}

/* -------------------------------- Sync ------------------------------------ */

let running = false
let again = false
let applyingRemote = false
let timer: ReturnType<typeof setTimeout> | undefined

interface Change {
  key: string
  deleted: boolean
  payload?: string
}

async function request(cfg: SyncConfig, keys: Keys, since: number, changes: Change[]) {
  let res: Response
  try {
    res = await fetch(cfg.server + 'sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sync-Space': keys.space, 'X-Sync-Token': keys.token },
      body: JSON.stringify({ since, changes }),
    })
  } catch {
    throw new Error(navigator.onLine ? 'Could not reach the sync server.' : 'offline')
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `Sync server error (${res.status}).`)
  return body as { seq: number; records: { key: string; seq: number; deleted: boolean; payload?: string }[] }
}

export async function syncNow(): Promise<void> {
  const cfg = getConfig()
  if (!cfg) return setStatus({ state: 'off' })
  if (running) {
    again = true
    return
  }
  running = true
  setStatus({ state: 'syncing', lastSync: cfg.lastSync })
  try {
    const keys = await keysFor(cfg.code)
    const state = new Map((await db.syncState.toArray()).map((s) => [s.key, s.hash]))

    // 1. What changed here since the last sync?
    const local = new Map<string, string>()
    const changes: Change[] = []
    for (const t of TABLES) {
      for (const rec of await db.table(t).toArray()) {
        const key = `${t}/${rec.id}`
        const json = JSON.stringify(rec)
        const hash = fnv1a(json)
        local.set(key, hash)
        if (state.get(key) !== hash) changes.push({ key, deleted: false, payload: await encrypt(keys.aes, json) })
      }
    }
    for (const key of state.keys()) if (!local.has(key)) changes.push({ key, deleted: true })

    // 2. Exchange with the server (it returns what other devices changed, minus what we're overwriting).
    const res = await request(cfg, keys, cfg.lastSeq, changes)

    // 3. Decrypt first: Dexie transactions must not wait on other async work.
    const incoming: { table: SyncTable; id: string; key: string; rec?: Record<string, unknown> }[] = []
    for (const r of res.records) {
      const slash = r.key.indexOf('/')
      const table = r.key.slice(0, slash) as SyncTable
      if (!TABLES.includes(table)) continue
      incoming.push({ table, id: r.key.slice(slash + 1), key: r.key, rec: r.deleted || !r.payload ? undefined : ((await decrypt(keys.aes, r.payload)) as Record<string, unknown>) })
    }

    applyingRemote = true
    await db.transaction('rw', [...TABLES.map((t) => db.table(t)), db.syncState], async () => {
      for (const c of changes) {
        if (c.deleted) await db.syncState.delete(c.key)
        else await db.syncState.put({ key: c.key, hash: local.get(c.key)! })
      }
      for (const r of incoming) {
        if (r.rec) {
          await db.table(r.table).put(r.rec)
          await db.syncState.put({ key: r.key, hash: fnv1a(JSON.stringify(r.rec)) })
        } else {
          await db.table(r.table).delete(r.id)
          await db.syncState.delete(r.key)
        }
      }
    })
    applyingRemote = false

    const now = Date.now()
    saveConfig({ ...cfg, lastSeq: res.seq, lastSync: now })
    setStatus({ state: 'idle', lastSync: now })
  } catch (e) {
    applyingRemote = false
    const message = (e as Error).message
    if (message === 'offline') setStatus({ state: 'offline', lastSync: cfg.lastSync })
    else if (e instanceof DOMException && e.name === 'OperationError') setStatus({ state: 'error', message: 'Could not decrypt data from the server — is the sync code right?', lastSync: cfg.lastSync })
    else setStatus({ state: 'error', message, lastSync: cfg.lastSync })
  } finally {
    running = false
    if (again) {
      again = false
      scheduleSync(500)
    }
  }
}

export function scheduleSync(ms = DEBOUNCE_MS) {
  if (!getConfig()) return
  clearTimeout(timer)
  timer = setTimeout(() => void syncNow(), ms)
}

/** Turn sync on with a code (new or from another device) and run the first sync, which merges both sides. */
export async function enableSync(code: string, server = defaultServer()) {
  if (normaliseCode(code).length < 16) throw new Error('That code is too short.')
  if (!crypto.subtle) throw new Error('Sync needs a secure (https) connection.')
  await db.syncState.clear() // first sync: everything here counts as new and is merged with the server
  saveConfig({ code: code.trim(), server: server.endsWith('/') ? server : server + '/', lastSeq: 0 })
  await syncNow()
  if (status.state === 'error') {
    const message = status.message
    saveConfig(undefined)
    setStatus({ state: 'off' })
    throw new Error(message)
  }
}

/** Stop syncing on this device. Local data stays; the server copy is untouched. */
export async function disableSync() {
  saveConfig(undefined)
  await db.syncState.clear()
  clearTimeout(timer)
  setStatus({ state: 'off' })
}

/** Call once at start-up: sync now, after local edits, when back online or visible again, and every minute. */
export function startAutoSync() {
  for (const t of TABLES) {
    const table = db.table(t)
    const onChange = () => {
      if (!applyingRemote) scheduleSync()
    }
    table.hook('creating', onChange)
    table.hook('updating', onChange)
    table.hook('deleting', onChange)
  }
  window.addEventListener('online', () => scheduleSync(500))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync(500)
  })
  setInterval(() => {
    if (document.visibilityState === 'visible') void syncNow()
  }, INTERVAL_MS)
  scheduleSync(800)
}
