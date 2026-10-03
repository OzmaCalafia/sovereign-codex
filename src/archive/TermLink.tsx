// Inline System Term components: the defining instance and the hover/tap definition popup.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useArchive } from './ArchiveContext';

type Props = { 'data-term'?: string; children?: ReactNode };

/** Marks where the book itself defines a term; the jump target for its links. */
export function TermDefinition({ 'data-term': slug, children }: Props) {
  return <span id={slug ? `def-${slug}` : undefined} className="term-def">{children}</span>;
}

/** A System Term: mouse hover or keyboard focus shows the definition; a touch tap shows it first, a second tap jumps. */
export function TermLink({ 'data-term': slug, children }: Props) {
  const { terms, goTo } = useArchive();
  const entry = slug ? terms[slug] : undefined;
  const tooltipId = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const pointerType = useRef('mouse');
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  // Places the popup below the term, or above when near the viewport bottom.
  const openPopup = () => {
    const rect = anchor.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(352, window.innerWidth - 16);
    const below = rect.bottom + 8;
    setPosition({
      left: Math.min(Math.max(8, rect.left), window.innerWidth - width - 8),
      top: below + 180 > window.innerHeight ? Math.max(8, rect.top - 168) : below,
    });
    setOpen(true);
  };

  // While open: Escape, an outside press, or scrolling dismisses the popup.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    const onPointer = (event: PointerEvent) => {
      if (!anchor.current?.parentElement?.contains(event.target as Node)) setOpen(false);
    };
    const dismiss = () => setOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('scroll', dismiss, { passive: true, once: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('scroll', dismiss);
    };
  }, [open]);

  if (!entry) return <>{children}</>;

  const jump = () => {
    setOpen(false);
    goTo(`def-${entry.slug}`);
  };

  return (
    <span className="term-link-wrap">
      <button
        ref={anchor}
        type="button"
        className="term-link"
        aria-describedby={open ? tooltipId : undefined}
        onPointerDown={(event) => { pointerType.current = event.pointerType; }}
        onPointerEnter={(event) => { if (event.pointerType === 'mouse') openPopup(); }}
        onPointerLeave={(event) => { if (event.pointerType === 'mouse') setOpen(false); }}
        onFocus={(event) => { if (event.currentTarget.matches(':focus-visible')) openPopup(); }}
        onClick={() => {
          if (pointerType.current === 'mouse' || open) jump();
          else openPopup();
        }}
      >
        {children}
      </button>
      {open && (
        <span id={tooltipId} role="tooltip" className="term-popup" style={position}>
          <strong className="term-popup__title">{entry.term}</strong>
          <span className="term-popup__body">{entry.definition}</span>
          <span className="term-popup__hint">Click to view where it is defined</span>
        </span>
      )}
    </span>
  );
}
