import { createContext, useContext, useRef } from 'react'
import { Nav } from './Nav'
import { usePublishedHeight } from './usePublishedHeight'
import './screen.css'

/**
 * What `App.tsx` pins above every screen: the connection banner. It lives above the routes,
 * because a queued booking is a fact about the whole app, but it is drawn in the frame's own
 * sticky box, below the title bar.
 */
export const ChromeBanner = createContext<React.ReactNode>(null)

interface Props {
  title: string
  /** Takes the title's place in the pinned bar. The title stays, visually hidden, as the h1. */
  bar?: React.ReactNode
  /** A line about the screen's own data, pinned under the banner. */
  notice?: string | undefined
  children: React.ReactNode
}

/** The frame every signed-in screen shares: a pinned title bar, its content, and the bottom bar. */
export function Screen({ title, bar, notice, children }: Props) {
  const banner = useContext(ChromeBanner)
  const page = useRef<HTMLDivElement>(null)
  const chrome = useRef<HTMLDivElement>(null)
  const nav = useRef<HTMLElement>(null)

  // What is pinned at either edge, for whatever a screen keeps clear of it: the banner's text
  // wraps and the notice comes and goes above, and the bottom bar carries the phone's inset below.
  usePublishedHeight(chrome, page, '--chrome-h')
  usePublishedHeight(nav, page, '--nav-h')

  return (
    <div className="page" ref={page}>
      <div className="app-chrome" ref={chrome}>
        <header className={bar === undefined ? 'topbar' : 'topbar topbar--bar'}>
          <h1 className={bar === undefined ? 'topbar__title' : 'visually-hidden'}>{title}</h1>
          {bar}
        </header>
        {banner}
        {notice !== undefined && (
          <p className="app-chrome__notice" role="status" data-testid="screen-notice">
            {notice}
          </p>
        )}
      </div>
      <main className="page__body">{children}</main>
      <Nav ref={nav} />
    </div>
  )
}
