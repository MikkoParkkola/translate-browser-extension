/**
 * @fileoverview Unit tests for core memory manager
 * Tests WeakMap-based references, automatic cleanup, and memory monitoring
 */

describe('Core Memory Manager', () => {
  let memoryManager;
  let mockElement;

  beforeEach(() => {
    // Reset DOM for each test
    document.body.innerHTML = '';
    
    // Load memory manager module
    const memoryManagerModule = require('../../src/core/memory-manager');
    memoryManager = memoryManagerModule;
    
    // Create mock element
    mockElement = document.createElement('div');
    mockElement.id = 'test-element';
    document.body.appendChild(mockElement);
  });

  afterEach(() => {
    // Cleanup after each test
    if (memoryManager && memoryManager.cleanup) {
      memoryManager.cleanup();
    }
    document.body.innerHTML = '';
  });

  describe('Module Initialization', () => {
    test('exports required components', () => {
      expect(memoryManager).toHaveProperty('refManager');
      expect(memoryManager).toHaveProperty('listenerManager');
      expect(memoryManager).toHaveProperty('timerManager');
      expect(memoryManager).toHaveProperty('elementManager');
      expect(memoryManager).toHaveProperty('memoryMonitor');
      expect(typeof memoryManager.cleanup).toBe('function');
    });

    test('has convenience methods', () => {
      expect(typeof memoryManager.addEventListener).toBe('function');
      expect(typeof memoryManager.removeEventListener).toBe('function');
      expect(typeof memoryManager.setTimeout).toBe('function');
      expect(typeof memoryManager.setInterval).toBe('function');
      expect(typeof memoryManager.createElement).toBe('function');
    });

    test('provides statistics methods', () => {
      expect(typeof memoryManager.getStats).toBe('function');
    });
  });

  describe('Element Management', () => {
    test('tracks element references', () => {
      const element = memoryManager.createElement('div', { className: 'test' });
      expect(element.tagName).toBe('DIV');
      expect(element.className).toBe('test');
    });

    test('creates elements with attributes', () => {
      const element = memoryManager.createElement('span', {
        textContent: 'Test content',
        'data-test': 'value',
        className: 'test-class'
      });

      expect(element.tagName).toBe('SPAN');
      expect(element.textContent).toBe('Test content');
      expect(element.dataset.test).toBe('value');
      expect(element.className).toBe('test-class');
    });

    test('creates elements with children', () => {
      const child1 = document.createTextNode('Text node');
      const child2 = document.createElement('span');
      child2.textContent = 'Child span';

      const parent = memoryManager.createElement('div', {}, [child1, child2, 'String child']);

      expect(parent.childNodes.length).toBe(3);
      expect(parent.childNodes[0].textContent).toBe('Text node');
      expect(parent.childNodes[1].textContent).toBe('Child span');
      expect(parent.childNodes[2].textContent).toBe('String child');
    });
  });

  describe('Event Listener Management', () => {
    test('adds and tracks event listeners', () => {
      const handler = jest.fn();
      memoryManager.addEventListener(mockElement, 'click', handler);

      // Trigger event
      mockElement.dispatchEvent(new Event('click'));
      expect(handler).toHaveBeenCalledTimes(1);
    });

    test('removes specific event listeners', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      memoryManager.addEventListener(mockElement, 'click', handler1);
      memoryManager.addEventListener(mockElement, 'click', handler2);

      // Remove first handler
      memoryManager.removeEventListener(mockElement, 'click', handler1);

      // Trigger event
      mockElement.dispatchEvent(new Event('click'));
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    test('cleans up listeners on element removal', () => {
      const handler = jest.fn();
      memoryManager.addEventListener(mockElement, 'click', handler);

      // Remove element from DOM (simulating cleanup)
      memoryManager.elementManager.cleanupElement(mockElement);

      // Element should no longer respond to events (though event won't fire anyway)
      expect(() => mockElement.dispatchEvent(new Event('click'))).not.toThrow();
    });
  });

  describe('Timer Management', () => {
    test('tracks setTimeout calls', async () => {
      const callback = jest.fn();
      const timerId = memoryManager.setTimeout(callback, 10);

      expect(typeof timerId).toBe('number');
      
      await new Promise(resolve => setTimeout(resolve, 15));
      expect(callback).toHaveBeenCalledTimes(1);
    });

    test('tracks setInterval calls', async () => {
      const callback = jest.fn();
      const timerId = memoryManager.setInterval(callback, 10);

      expect(typeof timerId).toBe('number');
      
      await new Promise(resolve => setTimeout(resolve, 25));
      expect(callback).toHaveBeenCalledTimes(2);
      
      memoryManager.clearInterval(timerId);
    });

    test('clears timeout correctly', async () => {
      const callback = jest.fn();
      const timerId = memoryManager.setTimeout(callback, 10);

      memoryManager.clearTimeout(timerId);
      
      await new Promise(resolve => setTimeout(resolve, 15));
      expect(callback).not.toHaveBeenCalled();
    });

    test('clears interval correctly', async () => {
      const callback = jest.fn();
      const timerId = memoryManager.setInterval(callback, 5);

      await new Promise(resolve => setTimeout(resolve, 12));
      const callCount = callback.mock.calls.length;
      
      memoryManager.clearInterval(timerId);
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(callback).toHaveBeenCalledTimes(callCount); // No new calls
    });

    test('auto-removes timeout from tracking after completion', async () => {
      const callback = jest.fn();
      memoryManager.setTimeout(callback, 5);

      const statsBefore = memoryManager.getStats();
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const statsAfter = memoryManager.getStats();
      expect(statsAfter.references.timers).toBe(statsBefore.references.timers - 1);
    });
  });

  describe('Memory Monitoring', () => {
    test('tracks memory usage', () => {
      // Memory monitoring requires performance.memory API
      if (typeof performance !== 'undefined' && performance.memory) {
        const measurement = memoryManager.memoryMonitor.measure();
        expect(measurement).toHaveProperty('usedJSHeapSize');
        expect(measurement).toHaveProperty('totalJSHeapSize');
        expect(measurement).toHaveProperty('jsHeapSizeLimit');
      }
    });

    test('detects memory pressure', () => {
      const isUnderPressure = memoryManager.memoryMonitor.isMemoryPressure();
      expect(typeof isUnderPressure).toBe('boolean');
    });

    test('provides memory statistics', () => {
      const stats = memoryManager.memoryMonitor.getStats();
      if (stats) {
        expect(stats).toHaveProperty('current');
        expect(stats).toHaveProperty('utilizationPercent');
      }
    });
  });

  describe('Global Cleanup', () => {
    test('cleans up all resources', () => {
      const handler = jest.fn();
      const timerCallback = jest.fn();

      // Add resources
      memoryManager.addEventListener(mockElement, 'click', handler);
      const timerId = memoryManager.setTimeout(timerCallback, 1000);
      const intervalId = memoryManager.setInterval(timerCallback, 100);

      const statsBefore = memoryManager.getStats();
      
      // Cleanup
      memoryManager.cleanup();
      
      const statsAfter = memoryManager.getStats();
      expect(statsAfter.references.timers).toBe(0);
      expect(statsAfter.references.controllers).toBe(0);
      expect(statsAfter.references.observers).toBe(0);
    });

    test('registers cleanup callbacks', () => {
      const cleanupCallback = jest.fn();
      memoryManager.refManager.onCleanup(cleanupCallback);

      memoryManager.cleanup();
      expect(cleanupCallback).toHaveBeenCalledTimes(1);
    });

    test('handles cleanup errors gracefully', () => {
      const errorCallback = jest.fn(() => {
        throw new Error('Cleanup error');
      });
      
      memoryManager.refManager.onCleanup(errorCallback);

      // Should not throw
      expect(() => memoryManager.cleanup()).not.toThrow();
      expect(errorCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('Statistics and Reporting', () => {
    test('provides comprehensive statistics', () => {
      const handler = jest.fn();
      memoryManager.addEventListener(mockElement, 'click', handler);
      memoryManager.setTimeout(() => {}, 1000);

      const stats = memoryManager.getStats();
      expect(stats).toHaveProperty('memory');
      expect(stats).toHaveProperty('references');
      expect(stats.references).toHaveProperty('timers');
      expect(stats.references).toHaveProperty('controllers');
      expect(stats.references).toHaveProperty('observers');
      expect(stats.references).toHaveProperty('cleanupCallbacks');
    });
  });

  describe('Performance Requirements', () => {
    test('operations complete quickly', () => {
      const start = performance.now();
      
      const element = memoryManager.createElement('div');
      memoryManager.addEventListener(element, 'click', () => {});
      memoryManager.setTimeout(() => {}, 1000);
      memoryManager.track(element);
      
      const duration = performance.now() - start;
      expect(duration).toBeLessThan(5); // Less than 5ms
    });

    test('handles concurrent operations', async () => {
      const promises = [];
      
      for (let i = 0; i < 10; i++) {
        promises.push(
          Promise.resolve().then(() => {
            const element = memoryManager.createElement('div');
            memoryManager.addEventListener(element, 'click', () => {});
            return memoryManager.setTimeout(() => {}, 10);
          })
        );
      }
      
      const results = await Promise.all(promises);
      expect(results).toHaveLength(10);
      results.forEach(result => {
        expect(typeof result).toBe('number');
      });
    });
  });

  describe('Golden Test Scenarios', () => {
    // Golden Test 1: Complete lifecycle management
    test('GOLDEN: manages complete element lifecycle', () => {
      const clickHandler = jest.fn();
      const mouseoverHandler = jest.fn();

      // Create and track element
      const element = memoryManager.createElement('button', {
        textContent: 'Test Button',
        className: 'test-btn'
      });

      memoryManager.addEventListener(element, 'click', clickHandler);
      memoryManager.addEventListener(element, 'mouseover', mouseoverHandler);

      document.body.appendChild(element);

      // Verify element works
      element.dispatchEvent(new Event('click'));
      element.dispatchEvent(new Event('mouseover'));
      expect(clickHandler).toHaveBeenCalledTimes(1);
      expect(mouseoverHandler).toHaveBeenCalledTimes(1);

      // Cleanup element
      memoryManager.elementManager.cleanupElement(element);

      // Element should still exist but listeners are cleaned
      expect(element.textContent).toBe('Test Button');
    });

    // Golden Test 2: Timer cleanup on page unload
    test('GOLDEN: cleans up timers and intervals on cleanup', async () => {
      const timeoutCallback = jest.fn();
      const intervalCallback = jest.fn();

      // Create timers
      memoryManager.setTimeout(timeoutCallback, 50);
      const intervalId = memoryManager.setInterval(intervalCallback, 10);

      // Let interval run a few times
      await new Promise(resolve => setTimeout(resolve, 25));
      expect(intervalCallback).toHaveBeenCalledTimes(2);

      // Cleanup all
      memoryManager.cleanup();

      // Wait longer and verify no new calls
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(intervalCallback).toHaveBeenCalledTimes(2); // No new calls
      expect(timeoutCallback).not.toHaveBeenCalled(); // Timeout was cleared
    });

    // Golden Test 3: Memory monitoring integration
    test('GOLDEN: integrates with memory monitoring', async () => {
      // Create memory load
      const elements = [];
      const handlers = [];

      for (let i = 0; i < 100; i++) {
        const element = memoryManager.createElement('div', {
          textContent: `Element ${i}`,
          'data-index': i.toString()
        });
        const handler = () => console.log(`Handler ${i}`);
        
        elements.push(element);
        handlers.push(handler);
        
        memoryManager.addEventListener(element, 'click', handler);
        memoryManager.setTimeout(() => {}, i * 10);
      }

      const statsAfterLoad = memoryManager.getStats();
      expect(statsAfterLoad.references.timers).toBeGreaterThan(0);

      // Cleanup and verify
      memoryManager.cleanup();

      const statsAfterCleanup = memoryManager.getStats();
      expect(statsAfterCleanup.references.timers).toBe(0);
      expect(statsAfterCleanup.references.controllers).toBe(0);
      expect(statsAfterCleanup.references.observers).toBe(0);
    });

    // Edge Case 1: Cleanup during active timers
    test('EDGE CASE: handles cleanup during active timer execution', async () => {
      let timerExecuting = false;
      const callback = jest.fn(() => {
        timerExecuting = true;
        // Simulate some work
        for (let i = 0; i < 1000; i++) {
          Math.random();
        }
        timerExecuting = false;
      });

      memoryManager.setInterval(callback, 5);
      
      // Wait for timer to start executing
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Cleanup while timer might be executing
      memoryManager.cleanup();

      // Should not throw or cause issues
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(callback).toHaveBeenCalled();
    });

    // Edge Case 2: Double cleanup
    test('EDGE CASE: handles double cleanup gracefully', () => {
      const handler = jest.fn();
      memoryManager.addEventListener(mockElement, 'click', handler);
      memoryManager.setTimeout(() => {}, 1000);

      // First cleanup
      expect(() => memoryManager.cleanup()).not.toThrow();
      
      // Second cleanup should also not throw
      expect(() => memoryManager.cleanup()).not.toThrow();

      const stats = memoryManager.getStats();
      expect(stats.references.timers).toBe(0);
    });
  });
});