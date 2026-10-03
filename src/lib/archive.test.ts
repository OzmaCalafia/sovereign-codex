import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { describe, expect, it } from 'vitest';
import { parseSystemTerms, remarkArchivePages, remarkSystemTerms, type ArchivePage } from './archive';

const sample = [
  '# **THE_\\[CONSTITUTION\\]**',
  '',
  '**(BY) Attribution:** unrelated bold with a parenthesis.',
  '',
  'The system is held in Tensegrity *(dynamic structural integrity)* by checks.',
  '',
  'Later, Tensegrity returns. A Node and the Origin Node appear; the Citizen’s Navigational Architecture *(framework of parameters)* grows.',
  '',
  'Bodily Autonomy *(sovereignty over one’s organism)* and the individual Sovereign organism *(conscious biological entity)*.',
].join('\n');

const pages: ArchivePage[] = [{ n: 1, id: 'OC-C-001', label: '1/1', start: 'THE_[CONSTITUTION]' }];

function render(markdown = sample) {
  const terms = parseSystemTerms(markdown);
  return renderToStaticMarkup(
    createElement(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkArchivePages(pages), remarkSystemTerms(terms)] }, markdown),
  );
}

describe('parseSystemTerms', () => {
  const terms = parseSystemTerms(sample);

  it('reads the capitalized phrase before an italic definition', () => {
    expect(terms.tensegrity.definition).toBe('dynamic structural integrity');
    expect(terms['bodily-autonomy'].term).toBe('Bodily Autonomy');
  });

  it('drops a leading possessive from the term', () => {
    expect(terms['navigational-architecture']).toBeDefined();
    expect(terms['citizen-s-navigational-architecture']).toBeUndefined();
  });

  it('accepts a lowercase final word', () => {
    expect(terms['sovereign-organism'].definition).toBe('conscious biological entity');
  });

  it('is not thrown off by a bold "**(BY)" earlier in the text', () => {
    expect(terms.tensegrity.definition).not.toContain('Attribution');
  });

  it('adds Node and Origin Node, which have no italic definition', () => {
    expect(terms.node.definition).toMatch(/distinct entity/);
    expect(terms['origin-node'].definition).toMatch(/not a vertical rank/);
  });
});

describe('remarkSystemTerms', () => {
  it('marks the defining mention and links later ones', () => {
    const html = render();
    expect(html).toMatch(/<term-def data-term="tensegrity">/);
    expect(html).toMatch(/<term-link data-term="tensegrity">/);
  });

  it('gives the same result when rendered again', () => {
    expect(render()).toBe(render());
  });

  it('prefers Origin Node over Node', () => {
    expect(render()).toContain('<term-def data-term="origin-node">');
  });

  it('does not link terms in blocks from the stop marker onward', () => {
    const md = 'A Tensegrity *(held tension)* here.\n\n# **\\[SOVEREIGN CODEX\\]**\n\n1\\. **The Tensegrity:**';
    const html = renderToStaticMarkup(
      createElement(ReactMarkdown, { remarkPlugins: [remarkSystemTerms(parseSystemTerms(md), '[SOVEREIGN CODEX]')] }, md),
    );
    expect(html).toContain('<term-def data-term="tensegrity">');
    expect(html).toContain('<strong>The Tensegrity:</strong>');
  });

  it('does not link terms inside headings', () => {
    const html = render('## Tensegrity\n\nA Tensegrity *(held tension)* here.');
    expect(html).toMatch(/<h2>Tensegrity<\/h2>/);
  });
});

describe('remarkArchivePages', () => {
  it('inserts a page break before the matching block', () => {
    const html = render();
    expect(html.indexOf('data-page="1"')).toBeLessThan(html.indexOf('<h1>'));
    expect(html).toContain('data-id="OC-C-001"');
  });

  it('links Topology Interface rows to the first page of their identifier', () => {
    const html = renderToStaticMarkup(
      createElement(ReactMarkdown, { remarkPlugins: [remarkArchivePages(pages)] }, '**\\[001\\]** THE **\\[CONSTITUTION\\]** | Origin: **\\[OC-C-001\\]**'),
    );
    expect(html).toContain('href="#page-1"');
  });
});
