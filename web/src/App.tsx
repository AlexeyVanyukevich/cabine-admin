import { useQuery } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { api, NotSignedIn } from './api'
import { Login } from './routes/Login'
import { Calendar } from './routes/Calendar'

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
  if (session.error) return <Trouble message={session.error.message} />
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
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <RequireSession>
              <Calendar />
            </RequireSession>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
