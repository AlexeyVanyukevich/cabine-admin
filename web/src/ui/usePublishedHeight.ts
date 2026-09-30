import { useLayoutEffect, type RefObject } from 'react'

/**
 * Keeps the custom property `name` on `host` equal to `source`'s rendered height, so a stylesheet
 * can offset by a box whose height follows its content — text that wraps, a line that comes and
 * goes — rather than by a number written down beside it.
 *
 * A layout effect, so the value is in place before any effect that scrolls by it.
 */
export function usePublishedHeight(
  source: RefObject<HTMLElement | null>,
  host: RefObject<HTMLElement | null>,
  name: string,
): void {
  useLayoutEffect(() => {
    const box = source.current
    const target = host.current
    if (box === null || target === null) return
    const publish = () => target.style.setProperty(name, `${box.offsetHeight}px`)
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(box)
    return () => observer.disconnect()
  }, [source, host, name])
}
