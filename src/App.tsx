import { createHashRouter, Link, Navigate, Outlet, RouterProvider } from 'react-router-dom'
import { Toaster } from './components/ui'
import { useOnline } from './lib/hooks'
import { useSyncStatus } from './lib/sync'
import { syncLabel } from './components/SyncCard'
import HomePage from './pages/HomePage'
import NewTripPage from './pages/NewTripPage'
import SettingsPage from './pages/SettingsPage'
import TripLayout, { TripIndex } from './pages/TripLayout'
import PlanPage from './pages/PlanPage'
import TodayPage from './pages/TodayPage'
import ChecklistPage from './pages/ChecklistPage'
import BudgetPage from './pages/BudgetPage'
import DocsPage from './pages/DocsPage'
import IdeasPage from './pages/IdeasPage'
import WalkPage from './pages/WalkPage'
import SharePage from './pages/SharePage'
import MorePage from './pages/MorePage'
import FavoritesPage from './pages/FavoritesPage'

function Shell() {
  const online = useOnline()
  const sync = useSyncStatus()
  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <Link to="/" className="brand">
            <img src="./icon-192.png" alt="" />
            Travel Manager
          </Link>
          <span className="spacer" />
          {!online && <span className="offline-pill">Offline</span>}
          {sync.state !== 'off' && (
            <Link to="/settings" className="btn btn-ghost btn-sm" title={syncLabel(sync)} aria-label={syncLabel(sync)}>
              {sync.state === 'syncing' ? '☁️ …' : sync.state === 'error' ? '☁️ ⚠️' : sync.state === 'offline' ? '☁️ ⏸' : '☁️ ✓'}
            </Link>
          )}
          <Link to="/settings" className="btn btn-ghost btn-sm" aria-label="Settings">
            ⚙️ <span className="hide-mobile">Settings</span>
          </Link>
        </div>
      </header>
      <Outlet />
      <Toaster />
    </>
  )
}

// Hash routing works on any static host (GitHub Pages, a file share) without server rewrites.
const router = createHashRouter([
  {
    element: <Shell />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/new', element: <NewTripPage /> },
      { path: '/settings', element: <SettingsPage /> },
      {
        path: '/trip/:tripId',
        element: <TripLayout />,
        children: [
          { index: true, element: <TripIndex /> },
          { path: 'today', element: <TodayPage /> },
          { path: 'plan', element: <PlanPage /> },
          { path: 'ideas', element: <IdeasPage /> },
          { path: 'checklist', element: <ChecklistPage /> },
          { path: 'budget', element: <BudgetPage /> },
          { path: 'docs', element: <DocsPage /> },
          { path: 'walk', element: <WalkPage /> },
          { path: 'favorites', element: <FavoritesPage /> },
          { path: 'share', element: <SharePage /> },
          { path: 'more', element: <MorePage /> },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
