import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { STATUS_LABEL } from './kinds'
import type { ItemStatus } from '../types'
import { t } from '../i18n'

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
          <button className="icon-btn" onClick={onClose} aria-label={t('Close')}>
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

/** A card whose header folds the content away: for long pages where you only want some parts open. */
export function Section({ title, summary, open, onToggle, children, className = '' }: { title: ReactNode; summary?: ReactNode; open: boolean; onToggle: () => void; children: ReactNode; className?: string }) {
  return (
    <section className={`card section ${open ? 'open' : ''} ${className}`}>
      <button type="button" className="section-head" onClick={onToggle} aria-expanded={open}>
        <span className="grow" style={{ textAlign: 'left' }}>
          <b>{title}</b>
          {summary && <span className="small muted"> {summary}</span>}
        </span>
        <span className="chev" aria-hidden>
          ▾
        </span>
      </button>
      {open && <div className="stack section-body">{children}</div>}
    </section>
  )
}

export function Counter({ value, onChange, min = 0, max = 20 }: { value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return (
    <div className="counter">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={t('Less')}>
        −
      </button>
      <b style={{ minWidth: 20, textAlign: 'center' }}>{value}</b>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={t('More')}>
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

/* Toasts: call toast('Saved') from anywhere; give it an action for "Undo" or "Push back". */
const EVT = 'tm-toast'
interface ToastDetail {
  message: string
  action?: { label: string; run: () => void | Promise<void> }
}
export function toast(message: string, action?: ToastDetail['action']) {
  window.dispatchEvent(new CustomEvent<ToastDetail>(EVT, { detail: { message, action } }))
}

export function Toaster() {
  const [msg, setT] = useState<ToastDetail>()
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const on = (e: Event) => {
      const d = (e as CustomEvent<ToastDetail>).detail
      setT(d)
      clearTimeout(timer)
      timer = setTimeout(() => setT(undefined), d.action ? 8000 : 2800)
    }
    window.addEventListener(EVT, on)
    return () => window.removeEventListener(EVT, on)
  }, [])
  if (!msg) return null
  return (
    <div className="toast row" style={{ gap: 12 }}>
      <span>{msg.message}</span>
      {msg.action && (
        <button
          className="btn-sm"
          style={{ color: '#fff', borderColor: 'rgb(255 255 255 / 0.5)', background: 'transparent' }}
          onClick={async () => {
            setT(undefined)
            await msg.action!.run()
          }}
        >
          {msg.action.label}
        </button>
      )}
    </div>
  )
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast(t('Copied to clipboard'))
  } catch {
    // Clipboard API needs a secure context; fall back to a hidden textarea.
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
    toast(t('Copied to clipboard'))
  }
}

/** 1–5 stars in halves, drawn from one glyph row so a half star needs no extra image. */
export function Stars({ value, title }: { value: number; title?: string }) {
  return (
    <span className="stars" style={{ '--v': value } as CSSProperties} title={title} role="img" aria-label={t('{n} out of 5', { n: value })}>
      ★★★★★
    </span>
  )
}
