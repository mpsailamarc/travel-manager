import { useState } from 'react'
import { findPlace, type GeoResult } from '../lib/apis'
import type { Place } from '../types'

interface Props {
  label: string
  value?: Place
  onChange: (p: Place | undefined) => void
  placeholder?: string
  near?: string // appended to the query, e.g. the day's city
}

/** Free-text place with an optional "Find" lookup (OpenStreetMap Nominatim) to attach coordinates. */
export function PlaceSearch({ label, value, onChange, placeholder, near }: Props) {
  const [results, setResults] = useState<GeoResult[]>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function find() {
    if (!value?.name) return
    setBusy(true)
    setError(undefined)
    try {
      const r = await findPlace(value.name, near)
      setResults(r)
      if (!r.length) setError(navigator.onLine ? 'No match — try a different spelling, or the street.' : 'Search needs an internet connection.')
    } catch {
      setError('Search needs an internet connection.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack" style={{ gap: 6 }}>
      <label>
        {label}
        <div className="row">
          <input
            value={value?.name ?? ''}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value ? { name: e.target.value } : undefined)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                find()
              }
            }}
          />
          <button type="button" className="btn-sm" onClick={find} disabled={busy || !value?.name}>
            {busy ? '…' : value?.lat != null ? '📍 Found' : 'Find'}
          </button>
        </div>
      </label>
      {error && <span className="tiny muted">{error}</span>}
      {results && results.length > 0 && (
        <div className="card tight stack" style={{ gap: 2 }}>
          {results.map((r) => (
            <button
              key={`${r.lat},${r.lon}`}
              type="button"
              className="btn-ghost"
              style={{ justifyContent: 'flex-start', textAlign: 'left' }}
              onClick={() => {
                onChange({ name: value?.name || r.name, lat: r.lat, lon: r.lon, country: r.countryCode })
                setResults(undefined)
              }}
            >
              <span className="small">
                <b>{r.name}</b> <span className="muted">{r.displayName.split(',').slice(1, 4).join(',')}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
