// Archive text processing: System Term parsing plus remark plugins for page breaks and term links.
import type { Root, RootContent, PhrasingContent, Parent } from 'mdast';

/** One printed page: footer id/label, text anchor, optional chapter and title (see public/print/pages.json). */
export type ArchivePage = {
  n: number;
  id?: string;
  label?: string;
  start?: string;
  chapter?: string;
  title?: string;
};

export type SystemTerm = { term: string; definition: string; slug: string; defineOnFirstUse?: boolean };
export type TermMap = Record<string, SystemTerm>;

const ZERO_WIDTH = /\u200b|\u200c|\u200d|\ufeff/g;

/** Lowercase hyphenated key for a term. */
export const termSlug = (term: string) =>
  term.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Strips markdown escapes, emphasis markers and zero-width characters for plain-text display. */
const clean = (text: string) =>
  text.replace(ZERO_WIDTH, '').replace(/\\([\\[\]()*_])/g, '$1').replace(/\*+/g, '').replace(/\s+/g, ' ').trim();

// Terms the book defines in running prose or lowercase, not in the italic "*( ... )*" form.
const SUPPLEMENTAL_TERMS = [
  { term: 'Node', definition: 'Any distinct entity—scaling from a single organism to a macro-geopolitical structure.' },
  { term: 'Origin Node', definition: 'Ozma Calafia, the creator of the [SYSTEM]—an emergence designation, not a vertical rank.' },
];

// A System Term is the capitalized phrase directly before an italic "*( ... )*" definition.
export function parseSystemTerms(markdown: string): TermMap {
  const terms: TermMap = {};
  const pattern = /(?<!\*)\*\(((?:(?!\)\*)[\s\S])+)\)\*/g;
  for (const match of markdown.matchAll(pattern)) {
    const before = clean(markdown.slice(Math.max(0, match.index - 120), match.index));
    const phrase = before.match(/((?:[A-Z][\w'’-]*\s+){0,3}[A-Z][\w'’-]*(?:\s+[a-z]+)?)$/);
    if (!phrase) continue;
    const term = phrase[1].replace(/^(The|A|An)\s+/, '').replace(/^(?:\S+['’]s\s+)+/, '');
    const slug = termSlug(term);
    if (!slug || terms[slug]) continue;
    terms[slug] = { term, definition: clean(match[1]), slug };
  }
  for (const entry of SUPPLEMENTAL_TERMS) terms[termSlug(entry.term)] ??= { ...entry, slug: termSlug(entry.term), defineOnFirstUse: true };
  return terms;
}

/** Plain text of a markdown node. */
function nodeText(node: RootContent | Root): string {
  if ('value' in node && typeof node.value === 'string') return node.value;
  return 'children' in node ? (node.children as RootContent[]).map(nodeText).join('') : '';
}

/** Whitespace-collapsed text used to match a page's `start` anchor. */
const normalize = (text: string) => text.replace(ZERO_WIDTH, '').replace(/\s+/g, ' ').trim();

/** First page number for each printed identifier such as OC-C-001. */
export function firstPageOfEachId(pages: ArchivePage[]): Record<string, number> {
  const first: Record<string, number> = {};
  for (const page of pages) if (page.id && !(page.id in first)) first[page.id] = page.n;
  return first;
}

// Inserts page-break nodes and links the Topology Interface rows to their first page.
export function remarkArchivePages(pages: ArchivePage[]) {
  return () => (tree: Root) => {
    const firstPage = firstPageOfEachId(pages);
    const starts = pages.filter((page) => page.start);
    let cursor = 0;
    const output: RootContent[] = [];

    for (const node of tree.children) {
      const text = normalize(nodeText(node));
      const page = starts[cursor];
      if (page && text.startsWith(page.start!)) {
        output.push({
          type: 'paragraph',
          children: [],
          data: {
            hName: 'page-break',
            hProperties: { 'data-page': page.n, 'data-id': page.id ?? '', 'data-label': page.label ?? '', 'data-title': page.title ?? '' },
          },
        } as RootContent);
        cursor += 1;
      }

      const origin = node.type === 'paragraph' ? text.match(/\| Origin: \[(OC-[^\]]+)\]$/) : null;
      if (origin && firstPage[origin[1]] && node.type === 'paragraph') {
        node.children = [{ type: 'link', url: `#page-${firstPage[origin[1]]}`, children: node.children } as PhrasingContent];
      }
      output.push(node);
    }
    tree.children = output;
  };
}

// Nodes where terms are never linked (headings, links, code, images, reference definitions).
const SKIP = new Set(['heading', 'link', 'linkReference', 'definition', 'code', 'inlineCode', 'image']);

// Wraps every System Term in a term-link; the defining occurrence becomes the jump target.
export function remarkSystemTerms(terms: TermMap, stopAt?: string) {
  const list = Object.values(terms).sort((a, b) => b.term.length - a.term.length);
  if (list.length === 0) return () => () => undefined;
  const escaped = list.map((entry) => entry.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(?<![\\w])(${escaped.join('|')})(?:s|es)?(?![\\w])`, 'g');
  const bySource = new Map(list.map((entry) => [entry.term, entry]));
  const defined = new Set<string>();

  const isDefinition = (node?: PhrasingContent) =>
    node?.type === 'emphasis' && normalize(nodeText(node as RootContent)).startsWith('(');

  const walk = (parent: Parent) => {
    const next: PhrasingContent[] = [];
    const children = parent.children as PhrasingContent[];
    children.forEach((child, index) => {
      if (SKIP.has(child.type) || isDefinition(child)) {
        next.push(child);
        return;
      }
      if (child.type !== 'text') {
        if ('children' in child) walk(child as Parent);
        next.push(child);
        return;
      }
      let last = 0;
      for (const match of child.value.matchAll(pattern)) {
        const entry = bySource.get(match[1]);
        if (!entry) continue;
        const end = match.index + match[0].length;
        if (match.index > last) next.push({ type: 'text', value: child.value.slice(last, match.index) });
        const defines = entry.defineOnFirstUse
          ? !defined.has(entry.slug)
          : child.value.slice(end).trim() === '' && isDefinition(children[index + 1]);
        defined.add(entry.slug);
        next.push({
          type: 'text',
          value: match[0],
          data: { hName: defines ? 'term-def' : 'term-link', hProperties: { 'data-term': entry.slug } },
        } as PhrasingContent);
        last = end;
      }
      if (last === 0) next.push(child);
      else if (last < child.value.length) next.push({ type: 'text', value: child.value.slice(last) });
    });
    parent.children = next as Parent['children'];
  };

  return () => (tree: Root) => {
    defined.clear();
    const stop = stopAt ? tree.children.findIndex((node) => normalize(nodeText(node)).startsWith(stopAt)) : -1;
    if (stop === -1) {
      walk(tree as unknown as Parent);
      return;
    }
    // Blocks from `stopAt` onward (the blank entry templates) stay unlinked.
    const head = { children: tree.children.slice(0, stop) } as unknown as Parent;
    walk(head);
    tree.children = [...(head.children as RootContent[]), ...tree.children.slice(stop)];
  };
}
