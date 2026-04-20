import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const shadowWalkerMocks = vi.hoisted(() => ({
  cleanupShadowObservers: vi.fn(),
  observeShadowRoot: vi.fn(),
  observeShadowRoots: vi.fn(),
}));

vi.mock('./shadow-dom-walker', () => ({
  cleanupShadowObservers: shadowWalkerMocks.cleanupShadowObservers,
  observeShadowRoot: shadowWalkerMocks.observeShadowRoot,
  observeShadowRoots: shadowWalkerMocks.observeShadowRoots,
}));

import { CONFIG } from '../config';
import { createMutationOrchestrator } from './mutation-orchestrator';

class FakeMutationObserver {
  static instances: FakeMutationObserver[] = [];

  readonly observe = vi.fn();
  readonly disconnect = vi.fn();
  private readonly callback: MutationCallback;

  constructor(callback: MutationCallback) {
    this.callback = callback;
    FakeMutationObserver.instances.push(this);
  }

  trigger(mutations: MutationRecord[]): void {
    this.callback(mutations, this as unknown as MutationObserver);
  }

  static reset(): void {
    FakeMutationObserver.instances = [];
  }
}

type MutationCallback = (mutations: MutationRecord[], observer: MutationObserver) => void;

function createMutationRecord(nodes: Node[]): MutationRecord {
  return {
    addedNodes: nodes as unknown as NodeList,
  } as MutationRecord;
}

describe('createMutationOrchestrator', () => {
  const realMutationObserver = globalThis.MutationObserver;
  const realRequestIdleCallback = window.requestIdleCallback;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeMutationObserver.reset();
    shadowWalkerMocks.cleanupShadowObservers.mockReset();
    shadowWalkerMocks.observeShadowRoot.mockReset();
    shadowWalkerMocks.observeShadowRoots.mockReset();
    shadowWalkerMocks.observeShadowRoots.mockReturnValue(vi.fn());
    globalThis.MutationObserver = FakeMutationObserver as unknown as typeof MutationObserver;
    delete (window as unknown as Record<string, unknown>).requestIdleCallback;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.MutationObserver = realMutationObserver;
    if (realRequestIdleCallback) {
      window.requestIdleCallback = realRequestIdleCallback;
    } else {
      delete (window as unknown as Record<string, unknown>).requestIdleCallback;
    }
  });

  it('starts the main observer once and wires shadow-root observation', () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const onNodesAdded = vi.fn();
    const orchestrator = createMutationOrchestrator({
      log,
      config: CONFIG,
      onNodesAdded,
    });

    orchestrator.start();
    orchestrator.start();

    expect(FakeMutationObserver.instances).toHaveLength(1);
    expect(FakeMutationObserver.instances[0]?.observe).toHaveBeenCalledWith(document.body, {
      childList: true,
      subtree: true,
    });
    expect(shadowWalkerMocks.observeShadowRoots).toHaveBeenCalledOnce();
    expect(orchestrator.isActive()).toBe(true);
    expect(log.info).toHaveBeenCalledWith(' MutationObserver started (with shadow DOM support)');
  });

  it('stops observation, clears timers, and runs shadow cleanup', () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const onNodesAdded = vi.fn();
    const cleanup = vi.fn();
    shadowWalkerMocks.observeShadowRoots.mockReturnValue(cleanup);

    const orchestrator = createMutationOrchestrator({
      log,
      config: CONFIG,
      onNodesAdded,
    });

    orchestrator.start();
    FakeMutationObserver.instances[0]?.trigger([
      createMutationRecord([document.createElement('p')]),
    ]);

    orchestrator.stop();
    vi.advanceTimersByTime(CONFIG.mutations.debounceMs + 100);

    expect(FakeMutationObserver.instances[0]?.disconnect).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(shadowWalkerMocks.cleanupShadowObservers).toHaveBeenCalled();
    expect(onNodesAdded).not.toHaveBeenCalled();
    expect(orchestrator.isActive()).toBe(false);
    expect(log.info).toHaveBeenCalledWith(' MutationObserver stopped');
  });

  it('debounces mutation batches before dispatching nodes', () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const onNodesAdded = vi.fn();
    const orchestrator = createMutationOrchestrator({
      log,
      config: CONFIG,
      onNodesAdded,
    });

    orchestrator.start();
    FakeMutationObserver.instances[0]?.trigger([
      createMutationRecord([document.createElement('p')]),
    ]);
    vi.advanceTimersByTime(CONFIG.mutations.debounceMs - 1);
    FakeMutationObserver.instances[0]?.trigger([
      createMutationRecord([document.createTextNode('dynamic text')]),
    ]);

    vi.advanceTimersByTime(CONFIG.mutations.debounceMs - 1);
    expect(onNodesAdded).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onNodesAdded).toHaveBeenCalledTimes(1);
    expect(onNodesAdded.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it('falls back to setTimeout chunking when requestIdleCallback is unavailable', () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const onNodesAdded = vi.fn();
    const orchestrator = createMutationOrchestrator({
      log,
      config: CONFIG,
      onNodesAdded,
    });

    orchestrator.start();
    const nodes = Array.from({ length: 201 }, (_, index) => {
      const element = document.createElement('span');
      element.textContent = `Node ${index}`;
      return element;
    });
    FakeMutationObserver.instances[0]?.trigger([createMutationRecord(nodes)]);

    vi.advanceTimersByTime(CONFIG.mutations.debounceMs);
    expect(onNodesAdded).toHaveBeenCalledTimes(1);
    expect(onNodesAdded.mock.calls[0]?.[0]).toHaveLength(CONFIG.mutations.batchCapPerCycle);

    vi.advanceTimersByTime(50);
    expect(onNodesAdded).toHaveBeenCalledTimes(2);
    expect(onNodesAdded.mock.calls[1]?.[0]).toHaveLength(CONFIG.mutations.batchCapPerCycle);

    vi.advanceTimersByTime(50);
    expect(onNodesAdded).toHaveBeenCalledTimes(3);
    expect(onNodesAdded.mock.calls[2]?.[0]).toHaveLength(1);
  });

  it('uses requestIdleCallback for deferred chunks when available', () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const onNodesAdded = vi.fn();
    const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
      callback({
        didTimeout: false,
        timeRemaining: () => 50,
      } as IdleDeadline);
      return 1;
    });
    window.requestIdleCallback = requestIdleCallback;

    const orchestrator = createMutationOrchestrator({
      log,
      config: CONFIG,
      onNodesAdded,
    });

    orchestrator.start();
    const nodes = Array.from({ length: 201 }, (_, index) => {
      const element = document.createElement('span');
      element.textContent = `Node ${index}`;
      return element;
    });
    FakeMutationObserver.instances[0]?.trigger([createMutationRecord(nodes)]);

    vi.advanceTimersByTime(CONFIG.mutations.debounceMs);

    expect(requestIdleCallback).toHaveBeenCalled();
    expect(onNodesAdded).toHaveBeenCalledTimes(3);
    expect(onNodesAdded.mock.calls[0]?.[0]).toHaveLength(CONFIG.mutations.batchCapPerCycle);
    expect(onNodesAdded.mock.calls[1]?.[0]).toHaveLength(CONFIG.mutations.batchCapPerCycle);
    expect(onNodesAdded.mock.calls[2]?.[0]).toHaveLength(1);
  });

  it('logs dropped mutations when the pending buffer overflows', () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const onNodesAdded = vi.fn();
    const orchestrator = createMutationOrchestrator({
      log,
      config: CONFIG,
      onNodesAdded,
    });

    orchestrator.start();
    const overflowMutations = Array.from({ length: CONFIG.mutations.maxPending + 200 }, () =>
      createMutationRecord([document.createElement('span')]));

    FakeMutationObserver.instances[0]?.trigger(overflowMutations);

    expect(log.warn).toHaveBeenCalledWith(
      `Dropped 200 mutations (maxPending=${CONFIG.mutations.maxPending})`,
    );
  });
});
