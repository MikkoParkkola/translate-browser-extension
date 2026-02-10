/**
 * Shadow DOM Walker
 *
 * Enables translation inside web component shadow roots by:
 * 1. Recursively walking open/closed shadow trees for text nodes
 * 2. Intercepting Element.prototype.attachShadow to capture closed roots
 * 3. Observing DOM mutations to detect new shadow hosts at runtime
 */

// ---------------------------------------------------------------------------
// Closed Shadow Root Registry
// ---------------------------------------------------------------------------

/**
 * WeakMap storing references to closed shadow roots captured via the
 * attachShadow interception. Keyed by host element so entries are GC'd
 * when the host is removed from the DOM.
 */
const closedShadowRoots = new WeakMap<Element, ShadowRoot>();

/** All known shadow roots (open + closed) for observer management */
const knownShadowRoots = new WeakSet<ShadowRoot>();

/** Track observers attached to shadow roots for cleanup */
const shadowObservers = new Map<ShadowRoot, MutationObserver>();

/** Whether the attachShadow interception is installed */
let interceptInstalled = false;

/** The original attachShadow method, saved before patching */
let originalAttachShadow: ((init: ShadowRootInit) => ShadowRoot) | null = null;

/**
 * Callback invoked when a NEW shadow root is discovered (open or closed).
 * Set by `observeShadowRoots` so the content script can wire up translation.
 */
let onShadowRootDiscovered: ((shadowRoot: ShadowRoot) => void) | null = null;

// ---------------------------------------------------------------------------
// attachShadow Interception (captures closed shadow roots)
// ---------------------------------------------------------------------------

/**
 * Install a one-time monkey-patch on `Element.prototype.attachShadow`
 * so we can capture closed shadow roots that are otherwise inaccessible.
 *
 * The patch is idempotent -- calling it multiple times is safe.
 */
export function installAttachShadowInterceptor(): void {
  if (interceptInstalled) return;

  originalAttachShadow = Element.prototype.attachShadow;

  Element.prototype.attachShadow = function patchedAttachShadow(
    this: Element,
    init: ShadowRootInit,
  ): ShadowRoot {
    const shadowRoot = originalAttachShadow!.call(this, init);

    // Store reference regardless of mode
    if (init.mode === 'closed') {
      closedShadowRoots.set(this, shadowRoot);
    }

    if (!knownShadowRoots.has(shadowRoot)) {
      knownShadowRoots.add(shadowRoot);
      onShadowRootDiscovered?.(shadowRoot);
    }

    return shadowRoot;
  };

  interceptInstalled = true;
}

/**
 * Remove the monkey-patch, restoring the original `attachShadow`.
 */
export function removeAttachShadowInterceptor(): void {
  if (!interceptInstalled || !originalAttachShadow) return;
  Element.prototype.attachShadow = originalAttachShadow;
  originalAttachShadow = null;
  interceptInstalled = false;
}

// ---------------------------------------------------------------------------
// Shadow Root Retrieval
// ---------------------------------------------------------------------------

/**
 * Get the shadow root for an element, checking both open and closed registries.
 */
function getShadowRoot(element: Element): ShadowRoot | null {
  // Open shadow roots are directly accessible
  if (element.shadowRoot) return element.shadowRoot;

  // Closed shadow roots from our interception
  return closedShadowRoots.get(element) ?? null;
}

// ---------------------------------------------------------------------------
// Recursive Shadow DOM Walker
// ---------------------------------------------------------------------------

/**
 * Recursively walk a DOM tree including all shadow roots, invoking
 * `callback` for every text node found.
 *
 * Handles:
 * - Open shadow roots (via `element.shadowRoot`)
 * - Closed shadow roots (via interceptor registry)
 * - Nested shadow DOMs (shadow inside shadow)
 * - Slots and distributed nodes
 *
 * Performance: Short-circuits when no shadow roots exist in a subtree by
 * checking `element.shadowRoot` / closedShadowRoots which are O(1) lookups.
 */
export function walkShadowRoots(
  root: Node,
  callback: (textNode: Text) => void,
): void {
  walkNode(root, callback);
}

/**
 * Internal recursive walker.
 */
function walkNode(node: Node, callback: (textNode: Text) => void): void {
  if (node.nodeType === Node.TEXT_NODE) {
    callback(node as Text);
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
    return;
  }

  // If this is an element, check for a shadow root first
  if (node.nodeType === Node.ELEMENT_NODE) {
    const shadowRoot = getShadowRoot(node as Element);
    if (shadowRoot) {
      // Walk the shadow tree
      walkNode(shadowRoot, callback);
      // Also walk light DOM children (they may be slotted or unslotted)
    }
  }

  // Walk child nodes (works for both Element and DocumentFragment/ShadowRoot)
  const children = node.childNodes;
  for (let i = 0; i < children.length; i++) {
    walkNode(children[i], callback);
  }
}

// ---------------------------------------------------------------------------
// Shadow Root Observer
// ---------------------------------------------------------------------------

/**
 * Start observing the DOM for new shadow hosts being added.
 *
 * When a new element with a shadow root is added to `root`, the `callback`
 * is invoked with that shadow root. This also installs the `attachShadow`
 * interceptor to catch closed shadow roots.
 *
 * Returns a cleanup function that disconnects all observers.
 */
export function observeShadowRoots(
  root: Node,
  callback: (shadowRoot: ShadowRoot) => void,
): () => void {
  // Install interceptor so we can catch closed shadow roots going forward
  installAttachShadowInterceptor();

  // Store the callback for the interceptor to use
  onShadowRootDiscovered = callback;

  // Scan existing DOM for shadow roots we may have missed
  scanForExistingShadowRoots(root, callback);

  // Watch for new elements being added that might have shadow roots
  const rootObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (let i = 0; i < mutation.addedNodes.length; i++) {
        const node = mutation.addedNodes[i];
        if (node.nodeType === Node.ELEMENT_NODE) {
          scanForExistingShadowRoots(node, callback);
        }
      }
    }
  });

  const observeTarget = root.nodeType === Node.DOCUMENT_NODE
    ? (root as Document).body ?? root
    : root;

  if (observeTarget) {
    rootObserver.observe(observeTarget, {
      childList: true,
      subtree: true,
    });
  }

  // Return cleanup function
  return () => {
    rootObserver.disconnect();
    onShadowRootDiscovered = null;
    cleanupShadowObservers();
    removeAttachShadowInterceptor();
  };
}

/**
 * Observe mutations inside a specific shadow root.
 * The returned MutationObserver is tracked for cleanup.
 */
export function observeShadowRoot(
  shadowRoot: ShadowRoot,
  onMutation: MutationCallback,
): MutationObserver {
  // Don't double-observe
  const existing = shadowObservers.get(shadowRoot);
  if (existing) return existing;

  const observer = new MutationObserver(onMutation);
  observer.observe(shadowRoot, {
    childList: true,
    subtree: true,
  });

  shadowObservers.set(shadowRoot, observer);
  return observer;
}

/**
 * Disconnect and remove all shadow root observers.
 */
export function cleanupShadowObservers(): void {
  for (const [, observer] of shadowObservers) {
    observer.disconnect();
  }
  shadowObservers.clear();
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively scan a subtree for elements that already have shadow roots.
 * Handles Document, DocumentFragment, and Element nodes.
 */
function scanForExistingShadowRoots(
  node: Node,
  callback: (shadowRoot: ShadowRoot) => void,
): void {
  // For Document / DocumentFragment nodes, scan their element children
  if (
    node.nodeType === Node.DOCUMENT_NODE ||
    node.nodeType === Node.DOCUMENT_FRAGMENT_NODE
  ) {
    const root = node as Document | DocumentFragment;
    const children = root.children ?? root.childNodes;
    for (let i = 0; i < children.length; i++) {
      scanForExistingShadowRoots(children[i], callback);
    }
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const element = node as Element;
  const shadowRoot = getShadowRoot(element);

  if (shadowRoot && !knownShadowRoots.has(shadowRoot)) {
    knownShadowRoots.add(shadowRoot);
    callback(shadowRoot);
    // Also scan inside the newly discovered shadow root for nested shadow hosts
    const shadowChildren = shadowRoot.childNodes;
    for (let i = 0; i < shadowChildren.length; i++) {
      scanForExistingShadowRoots(shadowChildren[i], callback);
    }
  } else if (shadowRoot) {
    // Already known, but still scan its children for nested shadow roots
    const shadowChildren = shadowRoot.childNodes;
    for (let i = 0; i < shadowChildren.length; i++) {
      scanForExistingShadowRoots(shadowChildren[i], callback);
    }
  }

  // Scan light DOM children
  const children = element.children;
  for (let i = 0; i < children.length; i++) {
    scanForExistingShadowRoots(children[i], callback);
  }
}

// ---------------------------------------------------------------------------
// Deep Selection (Shadow DOM-aware)
// ---------------------------------------------------------------------------

/**
 * Get the current text selection, traversing into shadow DOMs.
 *
 * `window.getSelection()` only sees selections in the main document.
 * When text is selected inside a shadow root (e.g., LinkedIn chat, web
 * components), we need to walk the active element chain into shadow roots
 * to find the actual selection.
 *
 * Strategy:
 * 1. Check `window.getSelection()` first (covers 99% of cases)
 * 2. If empty/collapsed, walk `document.activeElement` -> `shadowRoot`
 *    chain and check each shadow root's `getSelection()` (Chromium 53+)
 * 3. Also check our captured closed shadow roots
 */
export function getDeepSelection(): Selection | null {
  // Try main document first
  const mainSelection = window.getSelection();
  if (mainSelection && !mainSelection.isCollapsed && mainSelection.toString().trim()) {
    return mainSelection;
  }

  // Walk the active element chain into shadow roots
  let element: Element | null = document.activeElement;
  while (element) {
    const shadow = getShadowRoot(element);
    if (shadow) {
      // Chromium supports getSelection() on shadow roots since Chrome 53
      // TypeScript doesn't have this in its types, but it exists at runtime
      const shadowSelection = (shadow as unknown as { getSelection?: () => Selection | null }).getSelection?.();
      if (shadowSelection && !shadowSelection.isCollapsed && shadowSelection.toString().trim()) {
        return shadowSelection;
      }
      // Continue deeper — activeElement inside shadow root
      element = shadow.activeElement;
    } else {
      break;
    }
  }

  // Fallback: return whatever main selection has (even if collapsed)
  return mainSelection;
}

// ---------------------------------------------------------------------------
// Exports for Testing
// ---------------------------------------------------------------------------

/** Exposed for testing only. */
export const _testing = {
  closedShadowRoots,
  knownShadowRoots,
  shadowObservers,
  getShadowRoot,
  scanForExistingShadowRoots,
  get interceptInstalled() {
    return interceptInstalled;
  },
  get onShadowRootDiscovered() {
    return onShadowRootDiscovered;
  },
  /** Reset all internal state (tests only) */
  reset(): void {
    cleanupShadowObservers();
    removeAttachShadowInterceptor();
    onShadowRootDiscovered = null;
    // WeakMap/WeakSet can't be cleared, but test isolation handles this
    // by creating fresh elements each test.
  },
};
