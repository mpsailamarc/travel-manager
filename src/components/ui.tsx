import { useEffect, useState, type ReactNode } from 'react'
import { STATUS_LABEL } from './kinds'
import type { ItemStatus } from '../types'

export function Modal({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function StatusBadge({ status }: { status: ItemStatus }) {
  return <span className={`badge ${status}`}>{STATUS_LABEL[status]}</span>
}

export function Empty({ emoji, title, children }: { emoji: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="e">{emoji}</div>
      <h3 style={{ margin: '8px 0 6px', color: 'var(--ink)' }}>{title}</h3>
      {children}
    </div>
  )
}

export function Counter({ value, onChange, min = 0, max = 20 }: { value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return (
    <div className="counter">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Less">
        −
      </button>
      <b style={{ minWidth: 20, textAlign: 'center' }}>{value}</b>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="More">
        +
      </button>
    </div>
  )
}

export function Progress({ value, max, over }: { value: number; max: number; over?: boolean }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className={`progress ${over ? 'over' : ''}`}>
      <div style={{ width: `${pct}%` }} />
    </div>
  )
}

/* Toasts: call toast('Saved') from anywhere. */
const EVT = 'tm-toast'
export function toast(message: string) {
  window.dispatchEvent(new CustomEvent(EVT, { detail: message }))
}

export function Toaster() {
  const [msg, setMsg] = useState<string>()
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const on = (e: Event) => {
      setMsg((e as CustomEvent<string>).detail)
      clearTimeout(t)
      t = setTimeout(() => setMsg(undefined), 2800)
    }
    window.addEventListener(EVT, on)
    return () => window.removeEventListener(EVT, on)
  }, [])
  return msg ? <div className="toast">{msg}</div> : null
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast('Copied to clipboard')
  } catch {
    // Clipboard API needs a secure context; fall back to a hidden textarea.
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
    toast('Copied to clipboard')
  }
}
