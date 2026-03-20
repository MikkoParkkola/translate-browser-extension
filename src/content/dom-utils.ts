/**
 * DOM traversal utilities — element filtering, text node discovery
 */

import { CONFIG } from '../config';
import { SKIP_TAGS, TRANSLATED_ATTR } from './content-types';
import { walkShadowRoots } from './shadow-dom-walker';

// WeakMap cache for shouldSkip results — avoids redundant getComputedStyle
// across text nodes sharing the same parent element. Auto-GC'd when elements detach.
const skipCache = new WeakMap<Element, boolean>();

/**
 * Invalidate the skip cache for a specific element (used during undo)
 */
export function clearSkipCacheEntry(element: Element): void {
  skipCache.delete(element);
}

/**
 * Check if element should be skipped for translation
 */
export function shouldSkip(element: Element): boolean {
  // Check WeakMap cache first — many text nodes share parents
  const cached = skipCache.get(element);
  if (cached !== undefined) return cached;

  const result = shouldSkipUncached(element);
  skipCache.set(element, result);
  return result;
}

function shouldSkipUncached(element: Element): boolean {
  // Skip by tag name (cheapest check first)
  if (SKIP_TAGS.has(element.tagName)) return true;

  // Skip already translated
  if (element.getAttribute(TRANSLATED_ATTR)) return true;

  // Skip elements with contenteditable (isContentEditable checks inheritance, avoids DOM traversal)
  if ((element as HTMLElement).isContentEditable) return true;

  // Skip elements marked as no-translate
  if (element.hasAttribute('data-no-translate')) return true;

  // Skip elements with translate="no"
  if (element.getAttribute('translate') === 'no') return true;

  // Check visibility
  try {
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return true;
  } catch {
    // getComputedStyle can throw for detached elements
    return true;
  }

  return false;
}

// Pre-compiled regexes for isValidText (called per text node, thousands/page)
const NON_TRANSLATABLE_RE = /^[\s\d\p{P}\p{S}]+$/u;
const CODE_OR_URL_RE = /^(https?:|www\.|\/\/|{|}|\[|\]|function|const |let |var )/;
// Prices, measurements, quantities common on e-commerce pages (ah.nl, bol.com etc.)
const PRICE_OR_MEASURE_RE = /^[\s€$£¥₹\d.,\-+×x%°:/']+$/u;

/**
 * Validate text for translation
 */
export function isValidText(text: string | null): text is string {
  if (!text) return false;

  const trimmed = text.trim();
  if (trimmed.length < CONFIG.batching.minTextLength) return false;
  if (trimmed.length > CONFIG.batching.maxTextLength) return false;

  // Skip text that's only whitespace, numbers, or symbols
  if (NON_TRANSLATABLE_RE.test(trimmed)) return false;

  // Skip prices and measurements (e.g., "€29,99", "$10.50", "30%", "1,5")
  if (PRICE_OR_MEASURE_RE.test(trimmed)) return false;

  // Skip text that looks like code or URLs
  if (CODE_OR_URL_RE.test(trimmed)) return false;

  return true;
}

/**
 * Sanitize text for translation - remove problematic characters
 */
export function sanitizeText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// ============================================================================
// DOM Traversal
// ============================================================================

/**
 * Get all translatable text nodes in element.
 * Also traverses shadow roots (open and intercepted-closed) so that
 * text inside web components is included in translation.
 */
export function getTextNodes(root: Element): Text[] {
  const nodes: Text[] = [];

  // Standard TreeWalker for the light DOM
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (!parent || shouldSkip(parent)) return NodeFilter.FILTER_REJECT;
      if (!isValidText(node.textContent)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node: Node | null;
  while ((node = walker.nextNode())) {
    nodes.push(node as Text);
  }

  // Walk shadow roots for text nodes the TreeWalker cannot reach
  walkShadowRoots(root, (textNode) => {
    const parent = textNode.parentElement;
    if (!parent || shouldSkip(parent)) return;
    if (!isValidText(textNode.textContent)) return;
    // Avoid duplicates: TreeWalker already collected light-DOM text nodes
    if (!nodes.includes(textNode)) {
      nodes.push(textNode);
    }
  });

  return nodes;
}

/**
 * Get text nodes from a specific set of elements (for mutations).
 * Handles shadow roots inside added elements via getTextNodes which
 * now walks shadow trees automatically.
 */
export function getTextNodesFromNodes(nodes: Node[]): Text[] {
  const textNodes: Text[] = [];

  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement;
      if (parent && !shouldSkip(parent) && isValidText(node.textContent)) {
        textNodes.push(node as Text);
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      if (!shouldSkip(element)) {
        textNodes.push(...getTextNodes(element));
      }
    } else if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      // Handle ShadowRoot nodes directly (they are DocumentFragments)
      walkShadowRoots(node, (textNode) => {
        const parent = textNode.parentElement;
        if (parent && !shouldSkip(parent) && isValidText(textNode.textContent)) {
          textNodes.push(textNode);
        }
      });
    }
  }

  return textNodes;
}
