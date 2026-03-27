import type { Config } from '../config';
import {
  cleanupShadowObservers,
  observeShadowRoot,
  observeShadowRoots,
} from './shadow-dom-walker';

interface MutationOrchestratorLogger {
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
}

type MutationConfig = Config['mutations'];
type MutationCallback = (nodes: Node[]) => void | Promise<void>;

interface CreateMutationOrchestratorOptions {
  log: MutationOrchestratorLogger;
  config: { mutations: MutationConfig };
  onNodesAdded: MutationCallback;
}

export interface MutationOrchestrator {
  start: () => void;
  stop: () => void;
  isActive: () => boolean;
}

/**
 * Shared orchestration for dynamic content observation: buffer mutation
 * records, debounce processing, and translate in bounded chunks so large
 * mutation bursts do not monopolize the main thread.
 */
export function createMutationOrchestrator({
  log,
  config,
  onNodesAdded,
}: CreateMutationOrchestratorOptions): MutationOrchestrator {
  let pendingMutations: MutationRecord[] = [];
  let mutationDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let mutationObserver: MutationObserver | null = null;
  let shadowRootCleanup: (() => void) | null = null;
  let droppedMutationCount = 0;

  function processPendingMutations(): void {
    /* v8 ignore start -- debounce timer always fires with pending mutations */
    if (pendingMutations.length === 0) return;
    /* v8 ignore stop */

    const addedNodes: Node[] = [];
    for (const mutation of pendingMutations) {
      for (const node of mutation.addedNodes) {
        if (
          node.nodeType === Node.ELEMENT_NODE
          || node.nodeType === Node.TEXT_NODE
        ) {
          addedNodes.push(node);
        }
      }
    }

    pendingMutations = [];

    if (addedNodes.length === 0) return;

    if (addedNodes.length <= config.mutations.batchCapPerCycle) {
      void onNodesAdded(addedNodes);
      return;
    }

    void onNodesAdded(addedNodes.slice(0, config.mutations.batchCapPerCycle));

    let offset = config.mutations.batchCapPerCycle;
    const processNextChunk = () => {
      /* v8 ignore start -- chunk boundary guard in deferred processing */
      if (offset >= addedNodes.length) return;
      /* v8 ignore stop */

      const chunk = addedNodes.slice(offset, offset + config.mutations.batchCapPerCycle);
      offset += config.mutations.batchCapPerCycle;
      void onNodesAdded(chunk);

      if (offset < addedNodes.length) {
        if ('requestIdleCallback' in window) {
          window.requestIdleCallback(processNextChunk);
        } else {
          setTimeout(processNextChunk, 50);
        }
      }
    };

    /* v8 ignore start -- requestIdleCallback: chunked processing not reachable in jsdom */
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(processNextChunk);
    } else {
      setTimeout(processNextChunk, 50);
    }
    /* v8 ignore stop */
  }

  function handleMutations(mutations: MutationRecord[]): void {
    for (const mutation of mutations) {
      if (pendingMutations.length < config.mutations.maxPending) {
        pendingMutations.push(mutation);
      } else {
        droppedMutationCount++;
      }
    }

    /* v8 ignore start -- requires exactly 200 dropped mutations; diagnostic-only */
    if (droppedMutationCount > 0 && droppedMutationCount % 200 === 0) {
      log.warn(`Dropped ${droppedMutationCount} mutations (maxPending=${config.mutations.maxPending})`);
    }
    /* v8 ignore stop */

    if (mutationDebounceTimer !== null) {
      clearTimeout(mutationDebounceTimer);
    }

    mutationDebounceTimer = setTimeout(() => {
      mutationDebounceTimer = null;
      processPendingMutations();
    }, config.mutations.debounceMs);
  }

  return {
    start(): void {
      if (mutationObserver) return;

      mutationObserver = new MutationObserver(handleMutations);
      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });

      shadowRootCleanup = observeShadowRoots(document, (shadowRoot) => {
        observeShadowRoot(shadowRoot, handleMutations);
      });

      log.info(' MutationObserver started (with shadow DOM support)');
    },

    stop(): void {
      if (mutationObserver) {
        mutationObserver.disconnect();
        mutationObserver = null;
      }

      if (shadowRootCleanup) {
        shadowRootCleanup();
        shadowRootCleanup = null;
      }
      cleanupShadowObservers();

      if (mutationDebounceTimer !== null) {
        clearTimeout(mutationDebounceTimer);
        mutationDebounceTimer = null;
      }

      pendingMutations = [];
      log.info(' MutationObserver stopped');
    },

    isActive(): boolean {
      return mutationObserver !== null;
    },
  };
}
