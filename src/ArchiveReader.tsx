// Read tab: Reader (formatted text with term popups and page dividers) and Printed (original page scans) views.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import { parseSystemTerms, remarkArchivePages, remarkSystemTerms, type ArchivePage } from './lib/archive';
import { ArchiveContext } from './archive/ArchiveContext';
import { TermDefinition, TermLink } from './archive/TermLink';

const TOPOLOGY_PAGE = 5;
const CODEX_PAGE = 28;
// First block of the page 28 entry templates; terms there are not linked.
const CODEX_START = '[SOVEREIGN CODEX]';
const SETTINGS_KEY = 'sc-reader-settings';

type Mode = 'text' | 'printed';
type Settings = { width: number; fontSize: number };

/** Reads saved width/text-size, falling back to defaults. */
function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
    return { width: Number(saved.width) || 72, fontSize: Number(saved.fontSize) || 15 };
  } catch {
    return { width: 72, fontSize: 15 };
  }
}

// Printed page n -> /print/p-NN.jpg; heading shows the footer id like [OC-C-001] 1/2.
const pageSrc = (n: number) => `/print/p-${String(n).padStart(2, '0')}.jpg`;
const pageHeading = (page: ArchivePage) => (page.id && page.label ? `[${page.id}] ${page.label}` : page.title ?? `[${page.id}]`);

export default function ArchiveReader({ onBeginEntry }: { onBeginEntry: () => void }) {
  const [archiveText, setArchiveText] = useState('');
  const [pages, setPages] = useState<ArchivePage[]>([]);
  const [loadError, setLoadError] = useState('');
  const [mode, setMode] = useState<Mode>('text');
  const [printedPage, setPrintedPage] = useState(TOPOLOGY_PAGE);
  const [settings, setSettings] = useState(loadSettings);
  const [pastTopology, setPastTopology] = useState(false);
  const pendingTarget = useRef<string | null>(null);
  const viewerTop = useRef<HTMLDivElement>(null);

  // Load the archive text and page map together; a failure shows one error.
  useEffect(() => {
    const controller = new AbortController();
    const load = (url: string) =>
      fetch(url, { signal: controller.signal }).then((response) => {
        if (!response.ok) throw new Error(`Archive request failed (${response.status}).`);
        return response;
      });

    Promise.all([load('/archive.md').then((r) => r.text()), load('/print/pages.json').then((r) => r.json() as Promise<ArchivePage[]>)])
      .then(([text, pageList]) => {
        setArchiveText(text.replace(/\u200b/g, '')); // Zero-width spaces break **bold** parsing before punctuation.
        setPages(pageList);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setLoadError(error instanceof Error ? error.message : 'Unable to load the archive.');
      });

    return () => controller.abort();
  }, []);

  // Persist the width and text-size sliders.
  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  // Parsed once per load: System Terms, then remark plugins in order (pages before terms).
  const terms = useMemo(() => parseSystemTerms(archiveText), [archiveText]);
  const remarkPlugins = useMemo(() => [remarkGfm, remarkArchivePages(pages), remarkSystemTerms(terms, CODEX_START)], [pages, terms]);
  const lastPage = pages.length || 31;

  // Smooth-scrolls to an element id and flashes it.
  const scrollToId = useCallback((id: string) => {
    const element = document.getElementById(id);
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    element.classList.remove('flash-target');
    void element.offsetWidth;
    element.classList.add('flash-target');
  }, []);

  // Single navigation entry point for page links and term jumps in either view.
  const goTo = useCallback((target: string) => {
    const pageMatch = target.match(/^page-(\d+)$/);
    if (mode === 'printed' && pageMatch) {
      setPrintedPage(Number(pageMatch[1]));
      viewerTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (mode === 'printed') {
      pendingTarget.current = target;
      setMode('text');
      return;
    }
    scrollToId(target);
  }, [mode, scrollToId]);

  // Finishes a jump that required switching from Printed back to Reader.
  useEffect(() => {
    if (mode !== 'text' || !pendingTarget.current) return;
    const target = pendingTarget.current;
    pendingTarget.current = null;
    requestAnimationFrame(() => scrollToId(target));
  }, [mode, scrollToId]);

  // Track whether the reader has scrolled below the [TOPOLOGY INTERFACE].
  useEffect(() => {
    if (mode !== 'text' || !archiveText) return;
    const marker = document.getElementById(`page-${TOPOLOGY_PAGE}`);
    if (!marker) return;
    const observer = new IntersectionObserver(([entry]) => {
      setPastTopology(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    observer.observe(marker);
    return () => observer.disconnect();
  }, [mode, archiveText, pages]);

  // Opens the Printed view at a page.
  const openPrinted = (n: number) => {
    setPrintedPage(n);
    setMode('printed');
    requestAnimationFrame(() => viewerTop.current?.scrollIntoView({ block: 'start' }));
  };

  const showReturn = mode === 'text' ? pastTopology : printedPage !== TOPOLOGY_PAGE;
  const returnToTopology = () => goTo(`page-${TOPOLOGY_PAGE}`);

  // Markdown element styling plus the custom term-link, term-def and page-break elements.
  const components: Components = {
    h1: ({ children, node, ...props }) => { void node; return <h1 className="mb-5 mt-10 border-b border-[#303642] pb-3 text-2xl font-bold text-[#E5C158]" {...props}>{children}</h1>; },
    h2: ({ children, node, ...props }) => { void node; return <h2 className="mb-4 mt-10 border-b border-[#303642] pb-2 text-xl font-bold text-[#E5C158]" {...props}>{children}</h2>; },
    h3: ({ children, node, ...props }) => { void node; return <h3 className="mb-3 mt-7 text-lg font-semibold text-[#E5C158]" {...props}>{children}</h3>; },
    h4: ({ children, node, ...props }) => { void node; return <h4 className="mb-2 mt-6 text-base font-semibold text-gray-100" {...props}>{children}</h4>; },
    p: ({ children, node, ...props }) => { void node; return <p className="mb-4 whitespace-pre-wrap" {...props}>{children}</p>; },
    ul: ({ children, node, ...props }) => { void node; return <ul className="mb-5 list-disc space-y-2 pl-6" {...props}>{children}</ul>; },
    ol: ({ children, node, ...props }) => { void node; return <ol className="mb-5 list-decimal space-y-2 pl-6" {...props}>{children}</ol>; },
    blockquote: ({ children, node, ...props }) => { void node; return <blockquote className="mb-5 border-l-2 border-[#E5C158] pl-4 text-gray-300" {...props}>{children}</blockquote>; },
    a: ({ children, href, node, ...props }) => {
      void node;
      const internal = href?.startsWith('#');
      return (
        <a
          href={href}
          className="text-[#E5C158] underline decoration-[#806f36] underline-offset-4 hover:decoration-[#E5C158]"
          onClick={internal ? (event) => { event.preventDefault(); goTo(href!.slice(1)); } : undefined}
          {...props}
        >
          {children}
        </a>
      );
    },
    img: ({ alt, node, ...props }) => {
      void node;
      return <img alt={alt || 'Archive sigil diagram'} className="my-6 h-auto max-w-full" loading="lazy" {...props} />;
    },
    ...({
      'term-link': TermLink,
      'term-def': TermDefinition,
      'page-break': (props: Record<string, string>) => {
        const n = Number(props['data-page']);
        const page = pages.find((entry) => entry.n === n);
        return (
          <div id={`page-${n}`} className="page-break" role="separator" aria-label={`Page ${n}`}>
            <span className="page-break__id">{page ? pageHeading(page) : `Page ${n}`}</span>
            <button type="button" className="page-break__print" onClick={() => openPrinted(n)}>Printed p.{n}</button>
          </div>
        );
      },
    } as unknown as Components),
  };

  // Link to the Write tab shown at the end of the Archive.
  const codexCta = (
    <aside className="codex-cta" aria-label="Begin a [SOVEREIGN CODEX] entry">
      <button type="button" onClick={onBeginEntry} className="codex-cta__button">Initiate [SOVEREIGN CODEX]</button>
    </aside>
  );

  return (
    <ArchiveContext.Provider value={{ terms, pages, goTo }}>
      <section className="sc-cover-frame sc-cover-frame--read space-y-5 p-4" aria-labelledby="archive-reader-title">
        <header className="space-y-3 border-b border-[#202530] pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="archive-reader-title" className="text-lg font-bold text-[#E5C158]">The_[SYSTEM]_Archive</h2>
            <div role="group" aria-label="Reading view" className="flex border border-[#2b3245] text-xs">
              {(['text', 'printed'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  onClick={() => (value === 'printed' ? openPrinted(printedPage) : setMode('text'))}
                  className={`px-3 py-1.5 font-bold ${mode === value ? 'bg-[#E5C158] text-[#090a0f]' : 'text-gray-300 hover:text-[#E5C158]'}`}
                >
                  {value === 'text' ? 'Reader' : 'Printed'}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-gray-400">
            Full core text of The_[SYSTEM]_Archive.{' '}
            <a href="https://ozmacalafiasystem.org" target="_blank" rel="noreferrer" className="text-[#E5C158] underline underline-offset-4">Origin site</a>
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-gray-400">
            <label className="flex items-center gap-2">
              Width
              <input type="range" min={40} max={200} step={4} value={settings.width} onChange={(e) => setSettings({ ...settings, width: Number(e.target.value) })} className="accent-[#E5C158]" />
            </label>
            {mode === 'text' && (
              <label className="flex items-center gap-2">
                Text size
                <input type="range" min={12} max={26} value={settings.fontSize} onChange={(e) => setSettings({ ...settings, fontSize: Number(e.target.value) })} className="accent-[#E5C158]" />
              </label>
            )}
          </div>
        </header>

        {loadError ? (
          <p role="alert" className="border border-red-900/60 p-4 text-sm text-red-300">{loadError}</p>
        ) : !archiveText ? (
          <p role="status" className="text-sm text-gray-400">Loading the Archive…</p>
        ) : mode === 'text' ? (
          <>
            <article className="archive-reader mx-auto break-words leading-8 text-gray-200" style={{ maxWidth: `${settings.width}ch`, fontSize: `${settings.fontSize}px` }}>
              <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={[rehypeSlug]} components={components}>
                {archiveText}
              </ReactMarkdown>
            </article>
            {codexCta}
          </>
        ) : (
          <div ref={viewerTop} className="mx-auto space-y-3" style={{ maxWidth: `${settings.width}ch` }}>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-300">
              <button type="button" disabled={printedPage <= 1} onClick={() => setPrintedPage(printedPage - 1)} className="viewer-button">Previous</button>
              <label className="flex items-center gap-2">
                Page
                <select value={printedPage} onChange={(e) => setPrintedPage(Number(e.target.value))} className="border border-[#2b3245] bg-[#090a0f] px-2 py-1">
                  {Array.from({ length: lastPage }, (_, i) => i + 1).map((n) => {
                    const page = pages.find((entry) => entry.n === n);
                    return <option key={n} value={n}>{n}{page ? ` — ${pageHeading(page)}` : ''}</option>;
                  })}
                </select>
              </label>
              <button type="button" disabled={printedPage >= lastPage} onClick={() => setPrintedPage(printedPage + 1)} className="viewer-button">Next</button>
            </div>
            <img src={pageSrc(printedPage)} alt={`Printed page ${printedPage} of ${lastPage}`} className="h-auto w-full border border-[#303642] bg-white" />
            {printedPage >= CODEX_PAGE && codexCta}
          </div>
        )}

        {showReturn && (
          <button type="button" onClick={returnToTopology} className="return-button" aria-label="Return to the [TOPOLOGY INTERFACE]">
            ↑ [TOPOLOGY INTERFACE]
          </button>
        )}
      </section>
    </ArchiveContext.Provider>
  );
}
