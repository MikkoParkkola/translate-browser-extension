/**
 * Context extraction for improved translation
 */

import { getDeepSelection } from './shadow-dom-walker';

/**
 * Analyze page structure to provide translation context.
 * Returns a context string describing the page section a node belongs to.
 */
export function getPageContext(node: Text): string {
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

/**
 * Get surrounding context for better translation of ambiguous words
 * Extracts text before and after the selection from the containing block element
 */
export function getSelectionContext(): { before: string; after: string } | null {
  const selection = getDeepSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;

  // Get the paragraph or block element containing the selection
  const blockElement =
    container.nodeType === Node.TEXT_NODE
      ? container.parentElement?.closest('p, div, article, section, li, td, th, blockquote, h1, h2, h3, h4, h5, h6')
      : (container as Element).closest('p, div, article, section, li, td, th, blockquote, h1, h2, h3, h4, h5, h6');

  if (!blockElement) return null;

  const fullText = blockElement.textContent || '';
  const selectedText = selection.toString();
  const selectionIndex = fullText.indexOf(selectedText);

  if (selectionIndex === -1) return null;

  // Extract up to 150 chars before and after for context
  const maxContextLength = 150;
  const before = fullText.slice(Math.max(0, selectionIndex - maxContextLength), selectionIndex).trim();
  const after = fullText
    .slice(selectionIndex + selectedText.length, selectionIndex + selectedText.length + maxContextLength)
    .trim();

  // Only return context if there's meaningful text
  if (!before && !after) return null;

  return { before, after };
}
