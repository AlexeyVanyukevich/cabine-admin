import { NavLink } from 'react-router'
import './nav.css'

/**
 * A bottom bar rather than a top one: three screens on a phone held in one hand, and the
 * thumb reaches the bottom of the screen, not the top.
 */
export function Nav() {
  return (
    <nav className="nav" aria-label="Разделы">
      <NavLink className="nav__item" to="/" end>
        Календарь
      </NavLink>
      <NavLink className="nav__item" to="/guests">
        Гости
      </NavLink>
      <NavLink className="nav__item" to="/houses">
        Дома
      </NavLink>
    </nav>
  )
}
