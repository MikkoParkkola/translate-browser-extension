/**
 * DOM Mutation & Scanning Performance Tests
 *
 * Measures text node discovery, DOM replacement, MutationObserver processing,
 * and shadow DOM traversal at realistic page scales using performance.now().
 *
 * Run: npx vitest run src/__benchmarks__/dom-mutation.test.ts
 */

import { describe, it, expect } from 'vitest';
import { walkShadowRoots } from '../content/shadow-dom-walker';

const IS_COVERAGE_RUN =
  process.argv.includes('--coverage') ||
  process.env.npm_lifecycle_event === 'test:coverage' ||
  process.env.npm_lifecycle_event === 'validate:coverage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function measureSync(fn: () => void, iterations: number): number {
  const timings: number[] = [];
  for (let i = 0; i < Math.min(5, iterations); i++) fn();
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    timings.push(performance.now() - start);
  }
  timings.sort((a, b) => a - b);
  return timings[Math.floor(timings.length / 2)];
}

// ---------------------------------------------------------------------------
// DOM Fixture Builders
// ---------------------------------------------------------------------------

const SKIP_TAGS_LIST = ['STYLE', 'NOSCRIPT', 'CODE', 'TEXTAREA', 'PRE'];

function buildDomFixture(textNodeCount: number): HTMLElement {
  const root = document.createElement('div');
  for (let i = 0; i < textNodeCount; i++) {
    const depth = i % 20 === 0 ? 3 : 1;
    let parent: HTMLElement = root;
    for (let d = 0; d < depth; d++) {
      const wrapper = document.createElement(
        d === 0 ? 'div' : d === 1 ? 'section' : 'article',
      );
      parent.appendChild(wrapper);
      parent = wrapper;
    }
    if (i % 10 === 0) {
      const skip = document.createElement(
        SKIP_TAGS_LIST[i % SKIP_TAGS_LIST.length],
      );
      skip.textContent = `Skip this text node ${i}`;
      parent.appendChild(skip);
      continue;
    }
    const p = document.createElement('p');
    p.textContent = `This is translatable paragraph number ${i} with enough text to pass validation`;
    parent.appendChild(p);
  }
  return root;
}

function buildShadowDomFixture(
  hostCount: number,
  nodesPerHost: number,
): HTMLElement {
  const root = document.createElement('div');
  for (let h = 0; h < hostCount; h++) {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    for (let n = 0; n < nodesPerHost; n++) {
      const p = document.createElement('p');
      p.textContent = `Shadow text ${h}-${n}: translatable content inside web component`;
      shadow.appendChild(p);
    }
    root.appendChild(host);
  }
  return root;
}

function buildNestedShadowFixture(): HTMLElement {
  const fixture = document.createElement('div');
  let parent: HTMLElement | ShadowRoot = fixture;
  for (let level = 0; level < 3; level++) {
    for (let h = 0; h < 5; h++) {
      const host = document.createElement('div');
      if (parent instanceof ShadowRoot) parent.appendChild(host);
      else parent.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });
      for (let t = 0; t < 10; t++) {
        const p = document.createElement('span');
        p.textContent = `Nested shadow text L${level}-H${h}-T${t}`;
        shadow.appendChild(p);
      }
      if (h === 4) parent = shadow;
    }
  }
  return fixture;
}

/** Simulates content/index.ts text node discovery via TreeWalker */
function discoverTextNodes(root: Element): Text[] {
  const SKIP_TAGS = new Set([
    'SCRIPT',
    'STYLE',
    'NOSCRIPT',
    'TEMPLATE',
    'CODE',
    'PRE',
    'TEXTAREA',
    'INPUT',
    'SELECT',
    'BUTTON',
    'SVG',
    'MATH',
    'CANVAS',
    'VIDEO',
    'AUDIO',
    'IFRAME',
    'OBJECT',
    'EMBED',
  ]);
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (parent.getAttribute('data-translated'))
        return NodeFilter.FILTER_REJECT;
      const text = node.textContent?.trim();
      if (!text || text.length < 2) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node: Node | null;
  while ((node = walker.nextNode())) nodes.push(node as Text);
  return nodes;
}

// ---------------------------------------------------------------------------
// 1. Text Node Discovery
// ---------------------------------------------------------------------------

describe('benchmark: text node discovery', () => {
  for (const [count, limit] of [
    [100, 10],
    [1000, 50],
    [5000, 300],
  ] as const) {
    it(`discovers text nodes in ${count}-node DOM in <${limit}ms`, () => {
      const iterations = count <= 1000 ? 30 : 5;
      // Build fixtures once outside timing loop
      const fixtures = Array.from({ length: iterations }, () =>
        buildDomFixture(count),
      );
      const timings: number[] = [];
      for (let i = 0; i < iterations; i++) {
        document.body.appendChild(fixtures[i]);
        const start = performance.now();
        discoverTextNodes(fixtures[i]);
        timings.push(performance.now() - start);
        fixtures[i].remove();
      }
      timings.sort((a, b) => a - b);
      const median = timings[Math.floor(timings.length / 2)];

      console.log(`  discover (${count} nodes): ${median.toFixed(2)}ms`);
      expect(median).toBeLessThan(limit);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. DOM Replacement
// ---------------------------------------------------------------------------

describe('benchmark: DOM replacement', () => {
  const TRANSLATED_ATTR = 'data-translated';
  const ORIGINAL_TEXT_ATTR = 'data-original-text';
  const DOM_REPLACEMENT_LIMITS = IS_COVERAGE_RUN
    ? ([
        [100, 5],
        [1000, 80],
      ] as const)
    : ([
        [100, 5],
        [1000, 50],
      ] as const);

  for (const [count, limit] of DOM_REPLACEMENT_LIMITS) {
    it(`replaces ${count} text nodes in <${limit}ms`, () => {
      const iterations = count <= 100 ? 20 : 10;
      const fixtures = Array.from({ length: iterations }, () =>
        buildDomFixture(count),
      );
      const timings: number[] = [];
      for (let i = 0; i < iterations; i++) {
        document.body.appendChild(fixtures[i]);
        const textNodes = discoverTextNodes(fixtures[i]);
        const start = performance.now();
        for (const node of textNodes) {
          const original = node.textContent || '';
          const parent = node.parentElement;
          node.textContent = `[Translated] ${original}`;
          if (parent) {
            parent.setAttribute(TRANSLATED_ATTR, 'true');
            parent.setAttribute(ORIGINAL_TEXT_ATTR, original);
          }
        }
        timings.push(performance.now() - start);
        fixtures[i].remove();
      }
      timings.sort((a, b) => a - b);
      const median = timings[Math.floor(timings.length / 2)];

      console.log(`  replace (${count} nodes): ${median.toFixed(2)}ms`);
      expect(median).toBeLessThan(limit);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. MutationObserver Callback Processing
// ---------------------------------------------------------------------------

describe('benchmark: MutationObserver callback processing', () => {
  function processMutations(mutations: MutationRecord[]): Text[] {
    const addedNodes: Node[] = [];
    for (const mutation of mutations) {
      for (let i = 0; i < mutation.addedNodes.length; i++) {
        addedNodes.push(mutation.addedNodes[i]);
      }
    }
    const textNodes: Text[] = [];
    for (const node of addedNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.trim();
        if (text && text.length >= 2) textNodes.push(node as Text);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        textNodes.push(...discoverTextNodes(node as Element));
      }
    }
    return textNodes;
  }

  for (const mutationCount of [10, 50, 200]) {
    it(`processes ${mutationCount} mutations in <${mutationCount <= 50 ? 5 : 15}ms`, () => {
      // Relaxed limits — coverage instrumentation adds overhead
      const limit = mutationCount <= 50 ? 5 : 15;
      const mutations: MutationRecord[] = [];
      for (let i = 0; i < mutationCount; i++) {
        const p = document.createElement('p');
        p.textContent = `Dynamically added text node ${i} with translatable content`;
        mutations.push({
          type: 'childList',
          addedNodes: [p] as unknown as NodeList,
          removedNodes: [] as unknown as NodeList,
          target: document.body,
          attributeName: null,
          attributeNamespace: null,
          nextSibling: null,
          previousSibling: null,
          oldValue: null,
        } as MutationRecord);
      }

      const median = measureSync(() => processMutations(mutations), 100);

      console.log(
        `  process ${mutationCount} mutations: ${median.toFixed(3)}ms`,
      );
      expect(median).toBeLessThan(limit);
    });
  }
});

// ---------------------------------------------------------------------------
// 4. Shadow DOM Traversal
// ---------------------------------------------------------------------------

describe('benchmark: shadow DOM traversal', () => {
  for (const [hosts, nodesPerHost] of [
    [10, 10],
    [50, 20],
    [100, 10],
  ] as const) {
    const totalNodes = hosts * nodesPerHost;
    it(`walks ${hosts} hosts × ${nodesPerHost} nodes (${totalNodes} total) in <${totalNodes <= 200 ? 30 : 200}ms`, () => {
      // Relaxed limits — coverage instrumentation adds overhead
      const limit = totalNodes <= 200 ? 30 : 200;
      const median = measureSync(() => {
        const fixture = buildShadowDomFixture(hosts, nodesPerHost);
        document.body.appendChild(fixture);
        const collected: Text[] = [];
        walkShadowRoots(fixture, (textNode) => collected.push(textNode));
        fixture.remove();
      }, 20);

      console.log(
        `  walkShadowRoots (${hosts}×${nodesPerHost}): ${median.toFixed(2)}ms`,
      );
      expect(median).toBeLessThan(limit);
    });
  }

  const nestedShadowTraversalBudgetMs = IS_COVERAGE_RUN ? 25 : 15;

  it(`walks 3-level nested shadow DOM in <${nestedShadowTraversalBudgetMs}ms`, () => {
    const median = measureSync(() => {
      const fixture = buildNestedShadowFixture();
      document.body.appendChild(fixture);
      const collected: Text[] = [];
      walkShadowRoots(fixture, (textNode) => collected.push(textNode));
      fixture.remove();
    }, 20);

    console.log(`  walkShadowRoots (3-level nested): ${median.toFixed(2)}ms`);
    // Keep the default budget strict, but allow extra headroom under coverage
    // where nested shadow traversal pays a disproportionate instrumentation tax.
    expect(median).toBeLessThan(nestedShadowTraversalBudgetMs);
  });
});
