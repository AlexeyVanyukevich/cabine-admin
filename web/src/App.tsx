import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { api, NotSignedIn } from './api'
import { Login } from './routes/Login'
import { Calendar } from './routes/Calendar'
import { Guests } from './routes/Guests'
import { Houses } from './routes/Houses'
import { messageFor } from './errors'
import { ConnectionBanner } from './offline/ConnectionBanner'
import { SyncTray } from './offline/SyncTray'
import { useSync } from './offline/useOffline'

/**
 * The session is checked by asking the server, never by reading a cookie: the cookie is
 * httpOnly, and a client-side guess about whether it is still valid would eventually
 * disagree with the server that decides.
 */
function RequireSession({ children }: { children: React.ReactNode }) {
  const session = useQuery({
    queryKey: ['session'],
    queryFn: () => api.get<{ signedIn: true }>('/api/me'),
    retry: false,
  })

  if (session.isPending) return <Waiting />
  if (session.error instanceof NotSignedIn) return <Navigate to="/login" replace />
  if (session.error) return <Trouble message={messageFor(session.error)} />
  return <>{children}</>
}

function Waiting() {
  return (
    <div className="waiting" role="status" aria-live="polite">
      Загружаем…
    </div>
  )
}

function Trouble({ message }: { message: string }) {
  return (
    <div className="trouble" role="alert">
      <p>{message}</p>
      <button type="button" onClick={() => window.location.reload()}>
        Попробовать снова
      </button>
    </div>
  )
}

export function App() {
  // Held here, above the router, rather than once per screen: a queued booking is a fact about
  // the whole app, not about whichever route happens to be on screen when it was captured.
  const sync = useSync()
  const [trayOpen, setTrayOpen] = useState(false)
  const openTray = () => setTrayOpen(true)

  return (
    <BrowserRouter>
      <ConnectionBanner
        outcome={sync.outcome}
        intents={sync.intents}
        onOpenTray={openTray}
        // A full navigation, not a client-side one: the session is gone, so there is nothing an
        // in-app route change can do that a fresh load of /login cannot, and it matches how
        // `Trouble` below recovers from its own dead end.
        onRetry={() => window.location.assign('/login')}
      />
      <Routes>
        <Route path="/login" element={<Login onSignedIn={sync.syncNow} />} />
        <Route
          path="/"
          element={
            <RequireSession>
              <Calendar sync={sync} onOpenTray={openTray} />
            </RequireSession>
          }
        />
        <Route
          path="/guests"
          element={
            <RequireSession>
              <Guests />
            </RequireSession>
          }
        />
        <Route
          path="/houses"
          element={
            <RequireSession>
              <Houses />
            </RequireSession>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {trayOpen && (
        <SyncTray
          intents={sync.intents}
          onClose={() => setTrayOpen(false)}
          onResolve={() => {
            // The conflict screen that actually resolves one of these does not exist yet — it
            // is the next task's job. Until then the tray still lists the conflict truthfully
            // and "Отправить сейчас" still retries everything behind it.
          }}
          onRetry={sync.syncNow}
        />
      )}
    </BrowserRouter>
  )
}
