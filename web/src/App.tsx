import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { api, isOffline, NotSignedIn } from './api'
import { Login } from './routes/Login'
import { Calendar } from './routes/Calendar'
import { Guests } from './routes/Guests'
import { Houses } from './routes/Houses'
import { messageFor } from './errors'
import { ConnectionBanner } from './offline/ConnectionBanner'
import { SyncTray } from './offline/SyncTray'
import { ConflictScreen } from './offline/ConflictScreen'
import { dropIntent } from './offline/db'
import { useSync } from './offline/useOffline'
import type { Intent } from './offline/intents'
import type { RebookRequest } from './booking/NewBooking'

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
  // The request never reached the server — no answer, not a "no". Proceeding is safe: nothing
  // below this gate is a decision made in the browser, every read and write still goes through
  // the server, so there is nothing here to leak. If the session had in fact expired, the first
  // of those calls comes back 401, and `useSync`'s `runSync` (web/src/offline/sync.ts) already
  // pauses the queue and routes to login on exactly that — this gate is a convenience for the
  // common case, not the boundary that guards anything. Without this branch, a cold reload with
  // no network — the ordinary way this feature is meant to be used — never reaches the calendar.
  if (session.error && isOffline(session.error)) return <>{children}</>
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
  // `AppShell` rather than inline here: `useNavigate`/`useLocation` (needed to send a
  // conflict's "try again" back to the calendar from wherever the tray was opened) only work
  // inside `<BrowserRouter>`, and this component is the one that renders it.
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  )
}

function AppShell() {
  // Held here, above the routes, rather than once per screen: a queued booking is a fact about
  // the whole app, not about whichever route happens to be on screen when it was captured.
  const sync = useSync()
  const navigate = useNavigate()
  const location = useLocation()
  const [trayOpen, setTrayOpen] = useState(false)
  const openTray = () => setTrayOpen(true)

  // Calendar's own staleness line, reported up rather than rendered where it's computed: it has
  // to sit right beside `ConnectionBanner` inside the one sticky wrapper below, because two
  // independently `position: sticky` elements at the same offset overlap instead of stacking —
  // there is no fixed height to offset the second one by, since the banner's own text varies.
  // Sharing one sticky ancestor sidesteps that arithmetic entirely.
  const [staleNotice, setStaleNotice] = useState<string | undefined>()
  const onStaleNotice = useCallback((notice: string | undefined) => setStaleNotice(notice), [])

  // The conflict the owner is currently looking at, and the draft it hands to whichever
  // `NewBooking` sheet the owner opens next. Two separate pieces of state rather than one: the
  // screen closes the moment an action is chosen, but the draft has to survive until a fresh
  // selection on the grid actually opens that sheet — possibly after a route change.
  const [resolving, setResolving] = useState<Intent | undefined>()
  const [rebooking, setRebooking] = useState<RebookRequest | undefined>()

  function resolve(intent: Intent) {
    setTrayOpen(false)
    setResolving(intent)
  }

  function discard(intent: Intent) {
    setResolving(undefined)
    void dropIntent(intent.id).then(sync.reload)
  }

  function rebook(intent: Intent) {
    setResolving(undefined)
    // This exact attempt is spent — the engine has already answered it, and its payload is
    // frozen (`isEditable` in `intents.ts`). What is worth keeping is lifted into `rebooking`
    // below. The queue entry itself is deliberately NOT dropped here: it is the only durable
    // copy of the guest, price and add-on details until a replacement booking actually exists,
    // and this moment is well before that — the owner still has to drag nights and save.
    // `Calendar.tsx` drops it once the replacement is saved, or once the owner cancels that.
    //
    // The house and the nights are deliberately left out: the engine's refusal was about
    // occupancy, so occupancy is exactly what the owner re-decides, by dragging on the grid as
    // usual. Everything else — guest, price, add-ons, deposit, note — is never asked for again.
    const { guest, price_per_night, addons, deposit, note } = intent.payload
    setRebooking({
      intentId: intent.id,
      draft: {
        guest,
        price_per_night,
        addons,
        deposit,
        ...(note === undefined ? {} : { note }),
      },
    })

    if (location.pathname !== '/') navigate('/')
  }

  return (
    <>
      {/* Pinned to the top of the viewport. `Timeline` calls `scrollIntoView({block:'center'})`
          on mount (web/src/calendar/Timeline.tsx), which on a mid-month day scrolls the whole
          page well past here before the owner has read anything — this has to survive that. */}
      <div className="app-chrome">
        <ConnectionBanner
          outcome={sync.outcome}
          intents={sync.intents}
          onOpenTray={openTray}
          // A full navigation, not a client-side one: the session is gone, so there is nothing an
          // in-app route change can do that a fresh load of /login cannot, and it matches how
          // `Trouble` above recovers from its own dead end.
          onRetry={() => window.location.assign('/login')}
        />
        {staleNotice !== undefined && (
          <p className="app-chrome__notice" role="status">
            {staleNotice}
          </p>
        )}
      </div>
      <Routes>
        <Route path="/login" element={<Login onSignedIn={sync.syncNow} />} />
        <Route
          path="/"
          element={
            <RequireSession>
              <Calendar
                sync={sync}
                onOpenTray={openTray}
                onStaleNotice={onStaleNotice}
                {...(rebooking === undefined ? {} : { rebooking })}
                onRebookHandled={() => setRebooking(undefined)}
              />
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
          onResolve={resolve}
          onRetry={sync.syncNow}
        />
      )}

      {resolving !== undefined && (
        <ConflictScreen
          intent={resolving}
          onClose={() => setResolving(undefined)}
          onRebook={rebook}
          onDiscard={discard}
        />
      )}
    </>
  )
}
