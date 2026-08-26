import { useEffect, useRef } from 'react'
import './sheet.css'

interface Props {
  title: string
  onClose: () => void
  children: React.ReactNode
}

/**
 * A bottom sheet rather than a centred modal: the tool is used one-handed on a phone, and the
 * controls belong within reach of a thumb rather than at the top of the screen.
 */
export function Sheet({ title, onClose, children }: Props) {
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
      </div>
    </div>
  )
}
