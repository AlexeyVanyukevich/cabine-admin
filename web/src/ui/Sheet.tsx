import { useEffect, useRef } from 'react'
import './sheet.css'

interface Props {
  title: string
  onClose: () => void
  children: React.ReactNode
  /**
   * Pinned below the scrolling body. A button here submits a form in the body by carrying that
   * form's id in its own `form` attribute, since the two are no longer nested.
   */
  footer?: React.ReactNode
}

/**
 * A modal centred in the viewport, on the phone as well as the desktop. It caps at the height of
 * the screen and scrolls its body between a fixed title and a fixed footer, so a long form never
 * pushes its own controls out of view.
 */
export function Sheet({ title, onClose, children, footer }: Props) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    // Focus moves into the sheet so a keyboard lands where the eye already is.
    panel.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="sheet" role="presentation" onClick={onClose}>
      <div
        ref={panel}
        className="sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sheet__head">
          <h2 className="sheet__title">{title}</h2>
          <button className="sheet__close" type="button" aria-label="Закрыть" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="sheet__body">{children}</div>
        {footer !== undefined && <footer className="sheet__foot">{footer}</footer>}
      </div>
    </div>
  )
}
