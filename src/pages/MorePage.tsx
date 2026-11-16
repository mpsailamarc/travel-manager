import { Link } from 'react-router-dom'
import { t } from '../i18n'

const LINKS = [
  { to: '../ideas', emoji: '✨', label: t('Ideas (AI)'), desc: t('New itinerary ideas from ChatGPT, or a quick template') },
  { to: '../ideas?tab=bookings', emoji: '📧', label: t('Import booking emails'), desc: t('Paste confirmations: flights, hotels, tickets go into the plan') },
  { to: '../favorites', emoji: '🗺️', label: t('City planner'), desc: t('Every activity per city and day, sights and ChatGPT ideas, and your backup ideas') },
  { to: '../essentials', emoji: '🧭', label: t('Essentials'), desc: t('Emergency numbers, plugs, currency converter, tipping') },
  { to: '../docs', emoji: '📄', label: t('Documents'), desc: t('Passports, tickets, insurance — offline') },
  { to: '../share', emoji: '📤', label: t('Share trip'), desc: t('Send the plan to family as a file') },
  { to: '/settings', emoji: '⚙️', label: t('Settings'), desc: t('Nationality, currency, backups') },
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
