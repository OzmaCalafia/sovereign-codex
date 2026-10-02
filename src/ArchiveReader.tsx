import { useEffect, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';

const archiveSections = [
  ['Topology', 'topology-interface'],
  ['Key Nodes', 'key-nodes'],
  ['Constitution', 'the-constitution'],
  ['Six Tenets', 'the-six-tenets'],
  ['Foundational Framework', 'the-foundational-framework'],
  ['Iterative Dynamics', 'the-iterative-dynamics'],
  ['Sovereign Codex', 'sovereign-codex'],
] as const;

function allowArchiveUrl(url: string): string {
  if (url.startsWith('data:image/png;base64,')) return url;
  return defaultUrlTransform(url);
}

export default function ArchiveReader() {
  const [archiveText, setArchiveText] = useState('');
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    fetch('/archive.md', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Archive request failed (${response.status}).`);
        return response.text();
      })
      .then(setArchiveText)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setLoadError(error instanceof Error ? error.message : 'Unable to load the archive.');
      });

    return () => controller.abort();
  }, []);

  return (
    <section className="sc-cover-frame sc-cover-frame--read space-y-5 p-4" aria-labelledby="archive-reader-title">
      <header className="space-y-2 border-b border-[#202530] pb-4">
        <h2 id="archive-reader-title" className="text-lg font-bold text-[#E5C158]">The_[SYSTEM]_Archive</h2>
        <p className="text-xs text-gray-400">
          Full core text of The_[SYSTEM]_Archive.{' '}
          <a href="https://ozmacalafiasystem.org" target="_blank" rel="noreferrer" className="text-[#E5C158] underline underline-offset-4">
            Origin site
          </a>
        </p>
      </header>

      <nav aria-label="Archive sections" className="flex flex-wrap gap-2 border-b border-[#202530] pb-4">
        {archiveSections.map(([label, id]) => (
          <a
            key={id}
            href={`#${id}`}
            className="border border-[#2b3245] px-2.5 py-1.5 text-[11px] text-gray-300 transition hover:border-[#E5C158] hover:text-[#E5C158]"
          >
            {label}
          </a>
        ))}
      </nav>

      {loadError ? (
        <p role="alert" className="border border-red-900/60 p-4 text-sm text-red-300">{loadError}</p>
      ) : archiveText ? (
        <article className="archive-reader mx-auto max-w-[72ch] break-words text-sm leading-7 text-gray-200">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeSlug]}
            urlTransform={allowArchiveUrl}
            components={{
              h1: ({ children, ...props }) => <h1 className="mb-5 mt-10 border-b border-[#303642] pb-3 text-2xl font-bold text-[#E5C158]" {...props}>{children}</h1>,
              h2: ({ children, ...props }) => <h2 className="mb-4 mt-10 border-b border-[#303642] pb-2 text-xl font-bold text-[#E5C158]" {...props}>{children}</h2>,
              h3: ({ children, ...props }) => <h3 className="mb-3 mt-7 text-lg font-semibold text-[#E5C158]" {...props}>{children}</h3>,
              h4: ({ children, ...props }) => <h4 className="mb-2 mt-6 text-base font-semibold text-gray-100" {...props}>{children}</h4>,
              p: ({ children, ...props }) => <p className="mb-4 whitespace-pre-wrap" {...props}>{children}</p>,
              ul: ({ children, ...props }) => <ul className="mb-5 list-disc space-y-2 pl-6" {...props}>{children}</ul>,
              ol: ({ children, ...props }) => <ol className="mb-5 list-decimal space-y-2 pl-6" {...props}>{children}</ol>,
              blockquote: ({ children, ...props }) => <blockquote className="mb-5 border-l-2 border-[#E5C158] pl-4 text-gray-300" {...props}>{children}</blockquote>,
              a: ({ children, href, ...props }) => <a href={href} className="text-[#E5C158] underline decoration-[#806f36] underline-offset-4 hover:decoration-[#E5C158]" {...props}>{children}</a>,
              img: ({ alt, ...props }) => <img alt={alt || 'Archive sigil diagram'} className="my-6 h-auto max-w-full" loading="lazy" {...props} />,
            }}
          >
            {archiveText}
          </ReactMarkdown>
        </article>
      ) : (
        <p role="status" className="text-sm text-gray-400">Loading the Archive…</p>
      )}
    </section>
  );
}
