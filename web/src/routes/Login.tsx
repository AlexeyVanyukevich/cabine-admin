import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { api, ApiError } from '../api'
import { messageFor } from '../errors'
import './login.css'

export function Login() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await api.post('/api/login', { password })
      await navigate('/', { replace: true })
    } catch (cause) {
      // The server answers the same way for a wrong password and for one never set, and this
      // says the same thing back: which of the two it is must not be readable from here.
      setError(
        cause instanceof ApiError && cause.status === 401
          ? 'Неверный пароль'
          : messageFor(cause, 'Не удалось войти'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login">
      <form className="login__card" onSubmit={submit}>
        <div className="login__mark" aria-hidden="true">
          <span className="login__window login__window--lit" />
          <span className="login__window" />
        </div>

        <h1 className="login__title">Журнал</h1>
        <p className="login__subtitle">Два дома, гости и деньги</p>

        <label className="login__label" htmlFor="password">
          Пароль
        </label>
        <input
          id="password"
          className="login__input"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        {error !== undefined && (
          <p className="login__error" role="alert">
            {error}
          </p>
        )}

        <button className="login__submit" type="submit" disabled={busy || password.length === 0}>
          {busy ? 'Входим…' : 'Войти'}
        </button>
      </form>
    </main>
  )
}
