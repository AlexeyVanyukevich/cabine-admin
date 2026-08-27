import { Nav } from './Nav'
import './screen.css'

/** The frame every signed-in screen shares: a title, its content, and the bottom bar. */
export function Screen({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="page">
      <header className="topbar">
        <h1 className="topbar__title">{title}</h1>
      </header>
      <main className="page__body">{children}</main>
      <Nav />
    </div>
  )
}
