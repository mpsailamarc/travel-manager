import { Link } from 'react-router-dom'

const LINKS = [
  { to: '../ideas', emoji: '✨', label: 'Itinerary ideas (AI)', desc: 'Questionnaire → 3 itinerary options, budget & tips' },
  { to: '../favorites', emoji: '🗺️', label: 'City planner', desc: 'Every activity per city and day, sights and ChatGPT ideas, and your backup ideas' },
  { to: '../essentials', emoji: '🧭', label: 'Essentials', desc: 'Emergency numbers, plugs, currency converter, tipping' },
  { to: '../docs', emoji: '📄', label: 'Documents', desc: 'Passports, tickets, insurance — offline' },
  { to: '../share', emoji: '📤', label: 'Share trip', desc: 'Send the plan to family as a file' },
  { to: '/settings', emoji: '⚙️', label: 'Settings', desc: 'Nationality, currency, backups' },
]

export default function MorePage() {
  return (
    <div className="stack">
      {LINKS.map((l) => (
        <Link key={l.to} to={l.to} className="card tight row trip-card">
          <span style={{ fontSize: '1.6rem' }}>{l.emoji}</span>
          <div className="grow">
            <div className="strong">{l.label}</div>
            <div className="small muted">{l.desc}</div>
          </div>
          <span className="muted">›</span>
        </Link>
      ))}
    </div>
  )
}
