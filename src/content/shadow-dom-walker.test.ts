/**
 * Shadow DOM Walker unit tests
 *
 * Tests recursive shadow root walking, MutationObserver detection of new
 * shadow hosts, closed shadow root interception, and cleanup.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  walkShadowRoots,
  observeShadowRoots,
  observeShadowRoot,
  cleanupShadowObservers,
  installAttachShadowInterceptor,
  removeAttachShadowInterceptor,
  getDeepSelection,
  _testing,
} from './shadow-dom-walker';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect all text from walkShadowRoots into an array of strings. */
function collectTexts(root: Node): string[] {
  const texts: string[] = [];
  walkShadowRoots(root, (textNode) => {
    const t = textNode.textContent?.trim();
    if (t) texts.push(t);
  });
  return texts;
}

/**
 * Wait for MutationObserver to fire.
 * jsdom dispatches mutations asynchronously via microtask.
 */
async function flushObservers(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 0));
  await new Promise<void>((r) => setTimeout(r, 0));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('shadow-dom-walker', () => {
  beforeEach(() => {
    _testing.reset();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    _testing.reset();
    document.body.innerHTML = '';
  });

  // ========================================================================
  // walkShadowRoots
  // ========================================================================

  describe('walkShadowRoots', () => {
    it('walks text nodes in an open shadow DOM', () => {
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });
      const span = document.createElement('span');
      span.textContent = 'shadow text';
      shadow.appendChild(span);
      document.body.appendChild(host);

      const texts = collectTexts(document.body);
      expect(texts).toContain('shadow text');
    });

    it('walks text nodes in nested shadow DOMs (shadow inside shadow)', () => {
      const outerHost = document.createElement('div');
      const outerShadow = outerHost.attachShadow({ mode: 'open' });

      const innerHost = document.createElement('div');
      const innerShadow = innerHost.attachShadow({ mode: 'open' });
      const p = document.createElement('p');
      p.textContent = 'deeply nested';
      innerShadow.appendChild(p);

      outerShadow.appendChild(innerHost);
      document.body.appendChild(outerHost);

      const texts = collectTexts(document.body);
      expect(texts).toContain('deeply nested');
    });

    it('finds text in both light DOM and shadow DOM', () => {
      // Light DOM text
      const lightP = document.createElement('p');
      lightP.textContent = 'light text';
      document.body.appendChild(lightP);

      // Shadow DOM text
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });
      const shadowP = document.createElement('p');
      shadowP.textContent = 'shadow text';
      shadow.appendChild(shadowP);
      document.body.appendChild(host);

      const texts = collectTexts(document.body);
      expect(texts).toContain('light text');
      expect(texts).toContain('shadow text');
    });

    it('handles empty shadow roots without errors', () => {
      const host = document.createElement('div');
      host.attachShadow({ mode: 'open' });
      document.body.appendChild(host);

      const texts = collectTexts(document.body);
      // Should not throw and should return nothing from the empty shadow
      expect(texts).toEqual([]);
    });

    it('handles element with no shadow root', () => {
      const div = document.createElement('div');
      div.textContent = 'plain text';
      document.body.appendChild(div);

      const texts = collectTexts(document.body);
      expect(texts).toContain('plain text');
    });

    it('walks a ShadowRoot node directly', () => {
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });
      const span = document.createElement('span');
      span.textContent = 'direct shadow walk';
      shadow.appendChild(span);

      const texts = collectTexts(shadow);
      expect(texts).toContain('direct shadow walk');
    });

    it('walks multiple shadow hosts as siblings', () => {
      for (const label of ['first', 'second', 'third']) {
        const host = document.createElement('div');
        const shadow = host.attachShadow({ mode: 'open' });
        const p = document.createElement('p');
        p.textContent = `${label} shadow`;
        shadow.appendChild(p);
        document.body.appendChild(host);
      }

      const texts = collectTexts(document.body);
      expect(texts).toContain('first shadow');
      expect(texts).toContain('second shadow');
      expect(texts).toContain('third shadow');
    });

    it('handles disconnected nodes without errors', () => {
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<span>orphan text</span>';
      // NOT appended to document

      const texts = collectTexts(host);
      expect(texts).toContain('orphan text');
    });
  });

  // ========================================================================
  // attachShadow interception (closed shadow roots)
  // ========================================================================

  describe('attachShadow interception', () => {
    it('installs and removes the interceptor', () => {
      expect(_testing.interceptInstalled).toBe(false);
      installAttachShadowInterceptor();
      expect(_testing.interceptInstalled).toBe(true);
      removeAttachShadowInterceptor();
      expect(_testing.interceptInstalled).toBe(false);
    });

    it('is idempotent (calling install twice is safe)', () => {
      installAttachShadowInterceptor();
      installAttachShadowInterceptor(); // no-op
      expect(_testing.interceptInstalled).toBe(true);
      removeAttachShadowInterceptor();
      expect(_testing.interceptInstalled).toBe(false);
    });

    it('captures closed shadow roots via interception', () => {
      installAttachShadowInterceptor();

      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'closed' });
      const p = document.createElement('p');
      p.textContent = 'closed text';
      shadow.appendChild(p);
      document.body.appendChild(host);

      // The closed shadow root should be in our registry
      expect(_testing.closedShadowRoots.has(host)).toBe(true);

      // walkShadowRoots should find text in the closed shadow
      const texts = collectTexts(document.body);
      expect(texts).toContain('closed text');

      removeAttachShadowInterceptor();
    });

    it('still works for open shadow roots after interception', () => {
      installAttachShadowInterceptor();

      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<span>open after intercept</span>';
      document.body.appendChild(host);

      const texts = collectTexts(document.body);
      expect(texts).toContain('open after intercept');

      removeAttachShadowInterceptor();
    });

    it('notifies onShadowRootDiscovered for new shadow roots', () => {
      const discovered: ShadowRoot[] = [];
      installAttachShadowInterceptor();

      // Set the callback via the observe flow
      const cleanup = observeShadowRoots(document, (sr) => {
        discovered.push(sr);
      });

      const host = document.createElement('div');
      host.attachShadow({ mode: 'open' });
      document.body.appendChild(host);

      // The interceptor should have called our callback
      expect(discovered.length).toBeGreaterThanOrEqual(1);

      cleanup();
    });
  });

  // ========================================================================
  // observeShadowRoots
  // ========================================================================

  describe('observeShadowRoots', () => {
    it('discovers existing shadow roots on initial scan', () => {
      // Create shadow host BEFORE starting observation
      const host = document.createElement('div');
      host.attachShadow({ mode: 'open' });
      document.body.appendChild(host);

      const discovered: ShadowRoot[] = [];
      const cleanup = observeShadowRoots(document, (sr) => {
        discovered.push(sr);
      });

      expect(discovered.length).toBe(1);
      expect(discovered[0]).toBe(host.shadowRoot);

      cleanup();
    });

    it('detects new shadow hosts added to the DOM', async () => {
      const discovered: ShadowRoot[] = [];
      const cleanup = observeShadowRoots(document, (sr) => {
        discovered.push(sr);
      });

      // Add a new shadow host dynamically
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });
      document.body.appendChild(host);

      // The interceptor fires synchronously during attachShadow
      expect(discovered.length).toBeGreaterThanOrEqual(1);
      expect(discovered).toContain(shadow);

      cleanup();
    });

    it('cleanup disconnects all observers and removes interceptor', () => {
      const cleanup = observeShadowRoots(document, () => {});

      expect(_testing.interceptInstalled).toBe(true);

      cleanup();

      expect(_testing.interceptInstalled).toBe(false);
      expect(_testing.onShadowRootDiscovered).toBeNull();
    });
  });

  // ========================================================================
  // observeShadowRoot (individual shadow root observer)
  // ========================================================================

  describe('observeShadowRoot', () => {
    it('observes mutations inside a shadow root', async () => {
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });
      document.body.appendChild(host);

      const mutations: MutationRecord[][] = [];
      observeShadowRoot(shadow, (records) => {
        mutations.push([...records]);
      });

      // Add content inside shadow root
      const p = document.createElement('p');
      p.textContent = 'dynamic shadow content';
      shadow.appendChild(p);

      await flushObservers();

      expect(mutations.length).toBeGreaterThan(0);
      // The mutation should report the added <p>
      const addedNodes = mutations.flatMap((batch) =>
        batch.flatMap((m) => Array.from(m.addedNodes))
      );
      expect(addedNodes).toContain(p);
    });

    it('does not double-observe the same shadow root', () => {
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });

      const callback = vi.fn();
      const obs1 = observeShadowRoot(shadow, callback);
      const obs2 = observeShadowRoot(shadow, callback);

      expect(obs1).toBe(obs2); // Same observer returned
      expect(_testing.shadowObservers.size).toBe(1);
    });
  });

  // ========================================================================
  // cleanupShadowObservers
  // ========================================================================

  describe('cleanupShadowObservers', () => {
    it('disconnects all shadow observers', () => {
      const hosts = [
        document.createElement('div'),
        document.createElement('div'),
      ];
      const shadows = hosts.map((h) => h.attachShadow({ mode: 'open' }));

      shadows.forEach((s) => observeShadowRoot(s, vi.fn()));
      expect(_testing.shadowObservers.size).toBe(2);

      cleanupShadowObservers();
      expect(_testing.shadowObservers.size).toBe(0);
    });

    it('is safe to call when no observers exist', () => {
      expect(() => cleanupShadowObservers()).not.toThrow();
    });
  });

  // ========================================================================
  // Edge cases
  // ========================================================================

  describe('edge cases', () => {
    it('handles shadow root with only elements (no text)', () => {
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.appendChild(document.createElement('div'));
      shadow.appendChild(document.createElement('br'));
      document.body.appendChild(host);

      const texts = collectTexts(document.body);
      expect(texts).toEqual([]);
    });

    it('handles deeply nested mixed content (3+ levels)', () => {
      const host1 = document.createElement('div');
      const shadow1 = host1.attachShadow({ mode: 'open' });

      const host2 = document.createElement('div');
      const shadow2 = host2.attachShadow({ mode: 'open' });

      const host3 = document.createElement('div');
      const shadow3 = host3.attachShadow({ mode: 'open' });
      shadow3.innerHTML = '<p>level 3</p>';

      shadow2.appendChild(host3);
      shadow2.insertBefore(
        Object.assign(document.createElement('p'), { textContent: 'level 2' }),
        host3
      );

      shadow1.appendChild(host2);
      shadow1.insertBefore(
        Object.assign(document.createElement('p'), { textContent: 'level 1' }),
        host2
      );

      document.body.appendChild(host1);

      const texts = collectTexts(document.body);
      expect(texts).toContain('level 1');
      expect(texts).toContain('level 2');
      expect(texts).toContain('level 3');
    });

    it('handles removed shadow host gracefully', () => {
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<span>will be removed</span>';
      document.body.appendChild(host);

      // Remove from DOM
      document.body.removeChild(host);

      // Walking the detached subtree should still work
      const texts = collectTexts(host);
      expect(texts).toContain('will be removed');
    });

    it('handles whitespace-only text nodes in shadow DOM', () => {
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.appendChild(document.createTextNode('   '));
      shadow.appendChild(document.createTextNode('\n'));
      document.body.appendChild(host);

      const allTexts: string[] = [];
      walkShadowRoots(document.body, (textNode) => {
        allTexts.push(textNode.textContent ?? '');
      });
      // The callback IS called for whitespace nodes (filtering is caller's job)
      expect(allTexts.length).toBe(2);
      // But collectTexts trims and filters empties
      const trimmed = collectTexts(document.body);
      expect(trimmed).toEqual([]);
    });

    it('comment and processing instruction nodes are ignored', () => {
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.appendChild(document.createComment('a comment'));
      shadow.appendChild(document.createTextNode('real text'));
      document.body.appendChild(host);

      const texts = collectTexts(document.body);
      expect(texts).toEqual(['real text']);
    });
  });

  // ========================================================================
  // Integration: scanning + observing flow
  // ========================================================================

  describe('integration: scan + observe', () => {
    it('full flow: initial scan + dynamic addition + cleanup', async () => {
      // Pre-existing shadow host
      const existingHost = document.createElement('div');
      const existingShadow = existingHost.attachShadow({ mode: 'open' });
      existingShadow.innerHTML = '<p>existing</p>';
      document.body.appendChild(existingHost);

      const discovered: ShadowRoot[] = [];
      const cleanup = observeShadowRoots(document, (sr) => {
        discovered.push(sr);
      });

      // existing shadow should be discovered
      expect(discovered).toContain(existingShadow);

      // Add new shadow host dynamically
      const newHost = document.createElement('div');
      const newShadow = newHost.attachShadow({ mode: 'open' });
      newShadow.innerHTML = '<p>dynamic</p>';
      document.body.appendChild(newHost);

      // Interceptor fires synchronously
      expect(discovered).toContain(newShadow);

      // Walk everything and confirm both are found
      const texts = collectTexts(document.body);
      expect(texts).toContain('existing');
      expect(texts).toContain('dynamic');

      // Cleanup
      cleanup();
      expect(_testing.interceptInstalled).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getDeepSelection
  // -------------------------------------------------------------------------
  describe('getDeepSelection', () => {
    it('returns main document selection when text is selected there', () => {
      const div = document.createElement('div');
      div.textContent = 'Hello world';
      document.body.appendChild(div);

      // Create a real selection
      const range = document.createRange();
      range.selectNodeContents(div);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);

      const result = getDeepSelection();
      expect(result).not.toBeNull();
      expect(result!.toString()).toBe('Hello world');

      sel.removeAllRanges();
      document.body.removeChild(div);
    });

    it('returns null-like selection when nothing is selected', () => {
      window.getSelection()?.removeAllRanges();
      const result = getDeepSelection();
      // Returns the main selection object (collapsed), which is fine —
      // callers check isCollapsed
      expect(result).not.toBeNull();
      expect(result!.isCollapsed).toBe(true);
    });

    it('falls back to main selection when shadow root has no getSelection', () => {
      // Create a host with open shadow root
      const host = document.createElement('div');
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<span>Shadow text</span>';

      // No selection anywhere
      window.getSelection()?.removeAllRanges();

      // Mock activeElement to point into shadow host
      Object.defineProperty(document, 'activeElement', {
        value: host,
        configurable: true,
      });

      const result = getDeepSelection();
      // Should return main selection (collapsed) as fallback
      expect(result).not.toBeNull();

      // Cleanup
      Object.defineProperty(document, 'activeElement', {
        value: document.body,
        configurable: true,
      });
      document.body.removeChild(host);
    });
  });
});
