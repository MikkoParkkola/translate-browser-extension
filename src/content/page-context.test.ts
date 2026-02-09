/**
 * Contextual Page Semantics unit tests
 *
 * Tests getPageContext() which analyzes page structure to provide
 * translation context by walking up the DOM tree to find semantic containers.
 *
 * Since getPageContext is module-internal (not exported), we replicate
 * the pure logic for testing, following the established pattern
 * in offscreen.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// ============================================================================
// getPageContext logic (replicated from content/index.ts lines 1586-1615)
// ============================================================================

/**
 * Analyze page structure to provide translation context.
 * Returns a context string describing the page section a node belongs to.
 */
function getPageContext(node: Text): string {
  const sections: string[] = [];
  let el: Element | null = node.parentElement;

  // Walk up to find semantic containers
  while (el && sections.length < 3) {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role');

    // Semantic HTML5 elements
    if (tag === 'article' || role === 'article') sections.push('article body');
    else if (tag === 'nav' || role === 'navigation') sections.push('navigation menu');
    else if (tag === 'header' || role === 'banner') sections.push('page header');
    else if (tag === 'footer' || role === 'contentinfo') sections.push('page footer');
    else if (tag === 'aside' || role === 'complementary') sections.push('sidebar');
    else if (tag === 'main' || role === 'main') sections.push('main content');
    else if (tag === 'h1' || tag === 'h2' || tag === 'h3') sections.push(`heading level ${tag[1]}`);
    else if (el.classList.contains('comment') || el.classList.contains('comments')) sections.push('user comments');

    el = el.parentElement;
  }

  // Get page title for global context
  const title = document.title || '';

  if (sections.length === 0 && title) return title;
  if (sections.length > 0 && title) return `${title} > ${sections.reverse().join(' > ')}`;
  if (sections.length > 0) return sections.reverse().join(' > ');
  return '';
}

// ============================================================================
// getSelectionContext logic (replicated from content/index.ts lines 1621-1653)
// ============================================================================

function getSelectionContext(
  fullText: string,
  selectedText: string,
  maxContextLength = 150
): { before: string; after: string } | null {
  const selectionIndex = fullText.indexOf(selectedText);
  if (selectionIndex === -1) return null;

  const before = fullText.slice(
    Math.max(0, selectionIndex - maxContextLength),
    selectionIndex
  ).trim();
  const after = fullText.slice(
    selectionIndex + selectedText.length,
    selectionIndex + selectedText.length + maxContextLength
  ).trim();

  if (!before && !after) return null;

  return { before, after };
}

// ============================================================================
// Tests
// ============================================================================

describe('getPageContext', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.title = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.title = '';
  });

  describe('semantic HTML5 elements', () => {
    it('detects article element', () => {
      document.body.innerHTML = '<article><p id="target">Test text</p></article>';
      const textNode = document.querySelector('#target')!.firstChild as Text;
      const context = getPageContext(textNode);
      expect(context).toContain('article body');
    });

    it('detects nav element', () => {
      document.body.innerHTML = '<nav><a id="target">Home</a></nav>';
      const textNode = document.querySelector('#target')!.firstChild as Text;
      const context = getPageContext(textNode);
      expect(context).toContain('navigation menu');
    });

    it('detects header element', () => {
      document.body.innerHTML = '<header><span id="target">Logo</span></header>';
      const textNode = document.querySelector('#target')!.firstChild as Text;
      const context = getPageContext(textNode);
      expect(context).toContain('page header');
    });

    it('detects footer element', () => {
      document.body.innerHTML = '<footer><span id="target">Copyright</span></footer>';
      const textNode = document.querySelector('#target')!.firstChild as Text;
      const context = getPageContext(textNode);
      expect(context).toContain('page footer');
    });

    it('detects aside element', () => {
      document.body.innerHTML = '<aside><p id="target">Sidebar content</p></aside>';
      const textNode = document.querySelector('#target')!.firstChild as Text;
      const context = getPageContext(textNode);
      expect(context).toContain('sidebar');
    });

    it('detects main element', () => {
      document.body.innerHTML = '<main><p id="target">Main content</p></main>';
      const textNode = document.querySelector('#target')!.firstChild as Text;
      const context = getPageContext(textNode);
      expect(context).toContain('main content');
    });
  });

  describe('heading elements', () => {
    it('detects h1', () => {
      document.body.innerHTML = '<h1 id="target">Title</h1>';
      const textNode = document.querySelector('#target')!.firstChild as Text;
      const context = getPageContext(textNode);
      expect(context).toContain('heading level 1');
    });

    it('detects h2', () => {
      document.body.innerHTML = '<h2 id="target">Subtitle</h2>';
      const textNode = document.querySelector('#target')!.firstChild as Text;
      const context = getPageContext(textNode);
      expect(context).toContain('heading level 2');
    });

    it('detects h3', () => {
      document.body.innerHTML = '<h3 id="target">Section</h3>';
      const textNode = document.querySelector('#target')!.firstChild as Text;
      const context = getPageContext(textNode);
      expect(context).toContain('heading level 3');
    });
  });

  describe('ARIA role attributes', () => {
    it('detects role="article"', () => {
      document.body.innerHTML = '<div role="article"><p id="target">Content</p></div>';
      const textNode = document.querySelector('#target')!.firstChild as Text;
      const context = getPageContext(textNode);
      expect(context).toContain('article body');
    });

    it('detects role="navigation"', () => {
      document.body.innerHTML = '<div role="navigation"><a id="target">Link</a></div>';
      const textNode = document.querySelector('#target')!.firstChild as Text;
      const context = getPageContext(textNode);
      expect(context).toContain('navigation menu');
    });

    it('detects role="banner"', () => {
      document.body.innerHTML = '<div role="banner"><span id="target">Header</span></div>';
      const textNode = document.querySelector('#target')!.firstChild as Text;
      const context = getPageContext(textNode);
      expect(context).toContain('page header');
    });

    it('detects role="contentinfo"', () => {
      document.body.innerHTML = '<div role="contentinfo"><span id="target">Footer</span></div>';
      const textNode = document.querySelector('#target')!.firstChild as Text;
      const context = getPageContext(textNode);
      expect(context).toContain('page footer');
    });

    it('detects role="complementary"', () => {
      document.body.innerHTML = '<div role="complementary"><p id="target">Sidebar</p></div>';
      const textNode = document.querySelector('#target')!.firstChild as Text;
      const context = getPageContext(textNode);
      expect(context).toContain('sidebar');
    });

    it('detects role="main"', () => {
      document.body.innerHTML = '<div role="main"><p id="target">Content</p></div>';
      const textNode = document.querySelector('#target')!.firstChild as Text;
      const context = getPageContext(textNode);
      expect(context).toContain('main content');
    });
  });

  describe('CSS class-based detection', () => {
    it('detects .comment class', () => {
      document.body.innerHTML = '<div class="comment"><p id="target">User said...</p></div>';
      const textNode = document.querySelector('#target')!.firstChild as Text;
      const context = getPageContext(textNode);
      expect(context).toContain('user comments');
    });

    it('detects .comments class', () => {
      document.body.innerHTML = '<div class="comments"><p id="target">Discussion</p></div>';
      const textNode = document.querySelector('#target')!.firstChild as Text;
      const context = getPageContext(textNode);
      expect(context).toContain('user comments');
    });
  });

  describe('nested elements', () => {
    it('builds path from nested semantic elements (reversed order)', () => {
      document.body.innerHTML = `
        <main>
          <article>
            <p id="target">Nested content</p>
          </article>
        </main>
      `;
      const textNode = document.querySelector('#target')!.firstChild as Text;
      const context = getPageContext(textNode);
      // Should walk up: article -> main, reversed to: main content > article body
      expect(context).toContain('main content');
      expect(context).toContain('article body');
      expect(context.indexOf('main content')).toBeLessThan(context.indexOf('article body'));
    });

    it('limits to 3 semantic sections', () => {
      document.body.innerHTML = `
        <main>
          <article>
            <aside>
              <nav>
                <span id="target">Deep text</span>
              </nav>
            </aside>
          </article>
        </main>
      `;
      const textNode = document.querySelector('#target')!.firstChild as Text;
      const context = getPageContext(textNode);
      // Walks up: nav -> aside -> article -> main, but stops at 3
      const parts = context.split(' > ');
      // At most 3 semantic sections (plus possibly page title)
      const sectionParts = parts.filter((p) =>
        ['navigation menu', 'sidebar', 'article body', 'main content'].includes(p)
      );
      expect(sectionParts.length).toBeLessThanOrEqual(3);
    });
  });

  describe('page title integration', () => {
    it('returns page title when no semantic elements found', () => {
      document.title = 'My Page Title';
      document.body.innerHTML = '<div><span id="target">Plain text</span></div>';
      const textNode = document.querySelector('#target')!.firstChild as Text;
      const context = getPageContext(textNode);
      expect(context).toBe('My Page Title');
    });

    it('combines page title with semantic sections', () => {
      document.title = 'News Site';
      document.body.innerHTML = '<article><p id="target">Story text</p></article>';
      const textNode = document.querySelector('#target')!.firstChild as Text;
      const context = getPageContext(textNode);
      expect(context).toBe('News Site > article body');
    });

    it('returns sections without title when title is empty', () => {
      document.title = '';
      document.body.innerHTML = '<nav><a id="target">Link</a></nav>';
      const textNode = document.querySelector('#target')!.firstChild as Text;
      const context = getPageContext(textNode);
      expect(context).toBe('navigation menu');
    });

    it('returns empty string when no title and no semantic elements', () => {
      document.title = '';
      document.body.innerHTML = '<div><span id="target">Plain</span></div>';
      const textNode = document.querySelector('#target')!.firstChild as Text;
      const context = getPageContext(textNode);
      expect(context).toBe('');
    });
  });

  describe('non-semantic containers', () => {
    it('skips div elements without semantic meaning', () => {
      document.title = '';
      document.body.innerHTML = '<div><div><p id="target">Text</p></div></div>';
      const textNode = document.querySelector('#target')!.firstChild as Text;
      const context = getPageContext(textNode);
      expect(context).toBe('');
    });

    it('skips span elements', () => {
      document.title = '';
      document.body.innerHTML = '<span><span id="target">Text</span></span>';
      const textNode = document.querySelector('#target')!.firstChild as Text;
      const context = getPageContext(textNode);
      expect(context).toBe('');
    });
  });
});

describe('getSelectionContext', () => {
  describe('basic extraction', () => {
    it('extracts text before and after selection', () => {
      const result = getSelectionContext(
        'The quick brown fox jumps over the lazy dog',
        'fox'
      );
      expect(result).not.toBeNull();
      expect(result!.before).toBe('The quick brown');
      expect(result!.after).toBe('jumps over the lazy dog');
    });

    it('extracts text when selection is at the start', () => {
      const result = getSelectionContext(
        'Hello world, how are you',
        'Hello'
      );
      expect(result).not.toBeNull();
      expect(result!.before).toBe('');
      expect(result!.after).toBe('world, how are you');
    });

    it('extracts text when selection is at the end', () => {
      const result = getSelectionContext(
        'Hello world, how are you',
        'you'
      );
      expect(result).not.toBeNull();
      expect(result!.before).toBe('Hello world, how are');
      expect(result!.after).toBe('');
    });
  });

  describe('context length limiting', () => {
    it('limits context to 150 chars by default', () => {
      const longBefore = 'A'.repeat(200);
      const longAfter = 'B'.repeat(200);
      const fullText = `${longBefore}TARGET${longAfter}`;
      const result = getSelectionContext(fullText, 'TARGET');
      expect(result).not.toBeNull();
      expect(result!.before.length).toBeLessThanOrEqual(150);
      expect(result!.after.length).toBeLessThanOrEqual(150);
    });

    it('accepts custom context length', () => {
      const fullText = 'AAAAAAAAAABBBTargetCCCDDDDDDDDDD';
      const result = getSelectionContext(fullText, 'Target', 5);
      expect(result).not.toBeNull();
      expect(result!.before.length).toBeLessThanOrEqual(5);
      expect(result!.after.length).toBeLessThanOrEqual(5);
    });
  });

  describe('edge cases', () => {
    it('returns null when selected text is not found', () => {
      const result = getSelectionContext('Hello world', 'missing');
      expect(result).toBeNull();
    });

    it('returns null when no context exists (text is entire string)', () => {
      const result = getSelectionContext('Hello', 'Hello');
      // before='' and after='' -> returns null
      expect(result).toBeNull();
    });

    it('handles multi-word selection', () => {
      const result = getSelectionContext(
        'The quick brown fox jumps over the lazy dog',
        'brown fox jumps'
      );
      expect(result).not.toBeNull();
      expect(result!.before).toBe('The quick');
      expect(result!.after).toBe('over the lazy dog');
    });

    it('handles selection with special characters', () => {
      const result = getSelectionContext(
        'Price is $100.00 per item, tax included.',
        '$100.00'
      );
      expect(result).not.toBeNull();
      expect(result!.before).toBe('Price is');
      expect(result!.after).toBe('per item, tax included.');
    });
  });
});
