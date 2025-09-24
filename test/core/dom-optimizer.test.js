/**
 * @fileoverview Unit tests for DOM optimizer
 * Tests batched DOM operations, virtual DOM, and performance monitoring
 */

describe('DOM Optimizer', () => {
  let domOptimizer;
  let mockElements;

  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = '';
    
    // Load DOM optimizer module
    const domOptimizerModule = require('../../src/core/dom-optimizer');
    domOptimizer = domOptimizerModule;
    
    // Create mock elements for testing
    mockElements = {
      parent: document.createElement('div'),
      child1: document.createElement('span'),
      child2: document.createElement('p'),
      textNode: document.createTextNode('Original text')
    };
    
    mockElements.parent.id = 'test-parent';
    mockElements.child1.textContent = 'Child 1';
    mockElements.child2.textContent = 'Child 2';
    
    document.body.appendChild(mockElements.parent);
    mockElements.parent.appendChild(mockElements.child1);
    mockElements.parent.appendChild(mockElements.child2);
    mockElements.parent.appendChild(mockElements.textNode);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('Module Initialization', () => {
    test('exports required components', () => {
      expect(domOptimizer).toHaveProperty('batch');
      expect(domOptimizer).toHaveProperty('textOptimizer');
      expect(domOptimizer).toHaveProperty('elementOptimizer');
      expect(domOptimizer).toHaveProperty('performanceMonitor');
      expect(domOptimizer).toHaveProperty('differ');
    });

    test('provides convenience methods', () => {
      expect(typeof domOptimizer.replaceText).toBe('function');
      expect(typeof domOptimizer.createElement).toBe('function');
      expect(typeof domOptimizer.appendChildren).toBe('function');
      expect(typeof domOptimizer.batchReplace).toBe('function');
      expect(typeof domOptimizer.executeBatch).toBe('function');
    });

    test('has utility functions', () => {
      expect(typeof domOptimizer.defer).toBe('function');
      expect(typeof domOptimizer.measurePerformance).toBe('function');
    });
  });

  describe('Text Node Optimization', () => {
    test('replaces text in text nodes', async () => {
      const newText = 'Updated text';
      
      domOptimizer.replaceText(mockElements.textNode, newText);
      
      // Execute batch operations
      domOptimizer.executeBatch();
      
      // Wait for requestAnimationFrame
      await new Promise(resolve => requestAnimationFrame(resolve));
      
      expect(mockElements.textNode.textContent).toBe(newText);
    });

    test('preserves whitespace when requested', async () => {
      const textWithWhitespace = document.createTextNode('  Original text  ');
      mockElements.parent.appendChild(textWithWhitespace);
      
      domOptimizer.replaceText(textWithWhitespace, 'New', true);
      domOptimizer.executeBatch();
      await new Promise(resolve => requestAnimationFrame(resolve));
      
      expect(textWithWhitespace.textContent).toBe('  New  ');
    });

    test('handles empty text replacement', async () => {
      domOptimizer.replaceText(mockElements.textNode, '');
      domOptimizer.executeBatch();
      await new Promise(resolve => requestAnimationFrame(resolve));
      
      expect(mockElements.textNode.textContent).toBe('');
    });

    test('batch replaces multiple text nodes', async () => {
      const textNode2 = document.createTextNode('Second text');
      mockElements.parent.appendChild(textNode2);
      
      const replacements = [
        { node: mockElements.textNode, newText: 'First replaced' },
        { node: textNode2, newText: 'Second replaced' }
      ];
      
      domOptimizer.batchReplace(replacements);
      domOptimizer.executeBatch();
      await new Promise(resolve => requestAnimationFrame(resolve));
      
      expect(mockElements.textNode.textContent).toBe('First replaced');
      expect(textNode2.textContent).toBe('Second replaced');
    });

    test('skips identical text replacements', async () => {
      const originalText = mockElements.textNode.textContent;
      
      domOptimizer.replaceText(mockElements.textNode, originalText);
      domOptimizer.executeBatch();
      await new Promise(resolve => requestAnimationFrame(resolve));
      
      expect(mockElements.textNode.textContent).toBe(originalText);
    });
  });

  describe('Element Creation and Management', () => {
    test('creates elements with attributes', () => {
      const element = domOptimizer.createElement('div', {
        className: 'test-class',
        textContent: 'Test content',
        'data-test': 'value'
      });
      
      expect(element.tagName).toBe('DIV');
      expect(element.className).toBe('test-class');
      expect(element.textContent).toBe('Test content');
      expect(element.dataset.test).toBe('value');
    });

    test('creates elements with innerHTML', () => {
      const element = domOptimizer.createElement('div', {
        innerHTML: '<span>Inner content</span>'
      });
      
      expect(element.innerHTML).toBe('<span>Inner content</span>');
      expect(element.firstElementChild.tagName).toBe('SPAN');
    });

    test('caches elements when requested', () => {
      const element1 = domOptimizer.createElement('span', { className: 'cached' }, true);
      const element2 = domOptimizer.createElement('span', { className: 'cached' }, true);
      
      // Should be different instances but same structure
      expect(element1).not.toBe(element2);
      expect(element1.className).toBe(element2.className);
    });

    test('appends children efficiently', async () => {
      const children = [
        document.createElement('div'),
        document.createElement('span'),
        document.createElement('p')
      ];
      
      children.forEach((child, i) => {
        child.textContent = `Child ${i}`;
      });
      
      domOptimizer.appendChildren(mockElements.parent, children, true);
      domOptimizer.executeBatch();
      await new Promise(resolve => requestAnimationFrame(resolve));
      
      expect(mockElements.parent.children.length).toBe(5); // 2 original + 3 new
    });
  });

  describe('Virtual DOM and Diffing', () => {
    test('creates virtual nodes from elements', () => {
      const vNode = domOptimizer.VirtualNode.fromElement(mockElements.parent);
      
      expect(vNode.tagName).toBe('div');
      expect(vNode.attributes.id).toBe('test-parent');
      expect(vNode.children.length).toBeGreaterThan(0);
    });

    test('creates virtual nodes from text nodes', () => {
      const vNode = domOptimizer.VirtualNode.fromElement(mockElements.textNode);
      
      expect(vNode.tagName).toBe('#text');
      expect(vNode.textContent).toBe('Original text');
    });

    test('diffs virtual nodes correctly', () => {
      const oldVNode = new domOptimizer.VirtualNode('div', { id: 'old' }, []);
      const newVNode = new domOptimizer.VirtualNode('div', { id: 'new' }, []);
      
      const patches = domOptimizer.differ.diff(oldVNode, newVNode, mockElements.parent);
      
      expect(patches.length).toBeGreaterThan(0);
      expect(patches.some(p => p.type === 'setAttribute')).toBe(true);
    });

    test('identifies creation patches', () => {
      const newVNode = new domOptimizer.VirtualNode('span', { className: 'new' }, []);
      
      const patches = domOptimizer.differ.diff(null, newVNode, null);
      
      expect(patches.length).toBe(1);
      expect(patches[0].type).toBe('create');
    });

    test('identifies removal patches', () => {
      const oldVNode = new domOptimizer.VirtualNode('span', { className: 'old' }, []);
      
      const patches = domOptimizer.differ.diff(oldVNode, null, mockElements.child1);
      
      expect(patches.length).toBe(1);
      expect(patches[0].type).toBe('remove');
    });
  });

  describe('Batch Operations', () => {
    test('batches multiple operations', async () => {
      const startTime = performance.now();
      
      // Schedule multiple operations
      domOptimizer.batch.schedule({
        type: 'replaceText',
        element: mockElements.textNode,
        newText: 'Batched text',
        parent: mockElements.parent
      });
      
      domOptimizer.batch.schedule({
        type: 'setAttribute',
        element: mockElements.child1,
        name: 'data-batched',
        value: 'true'
      });
      
      // Operations should execute in single frame
      await new Promise(resolve => requestAnimationFrame(resolve));
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      expect(mockElements.textNode.textContent).toBe('Batched text');
      expect(mockElements.child1.dataset.batched).toBe('true');
      expect(duration).toBeLessThan(30); // Should complete quickly, allow slight variance
    });

    test('groups operations by parent', async () => {
      const parent2 = document.createElement('div');
      document.body.appendChild(parent2);
      
      domOptimizer.batch.schedule({
        type: 'appendChild',
        parent: mockElements.parent,
        element: document.createElement('span'),
        useFragment: false
      });
      
      domOptimizer.batch.schedule({
        type: 'appendChild',
        parent: parent2,
        element: document.createElement('div'),
        useFragment: false
      });
      
      await new Promise(resolve => requestAnimationFrame(resolve));
      
      expect(mockElements.parent.children.length).toBe(3); // +1
      expect(parent2.children.length).toBe(1);
    });

    test('handles operation errors gracefully', async () => {
      // Schedule invalid operation
      domOptimizer.batch.schedule({
        type: 'invalid-operation',
        element: null
      });
      
      // Should not throw
      await new Promise(resolve => requestAnimationFrame(resolve));
    });
  });

  describe('Performance Monitoring', () => {
    test('tracks operation performance', () => {
      const operation = domOptimizer.performanceMonitor.startOperation('test-operation');
      
      expect(operation.type).toBe('test-operation');
      expect(typeof operation.startTime).toBe('number');
      
      const duration = domOptimizer.performanceMonitor.endOperation(operation);
      expect(typeof duration).toBe('number');
      expect(duration).toBeGreaterThanOrEqual(0);
    });

    test('identifies slow operations', () => {
      const operation = {
        type: 'slow-operation',
        startTime: performance.now() - 100 // 100ms ago
      };
      
      const duration = domOptimizer.performanceMonitor.endOperation(operation);
      const metrics = domOptimizer.performanceMonitor.getMetrics();
      
      expect(duration).toBeGreaterThan(50);
      expect(metrics.slowOperations.length).toBeGreaterThan(0);
    });

    test('calculates average operation time', () => {
      // Reset to avoid interference from other tests
      domOptimizer.performanceMonitor.reset();
      
      const operations = ['op1', 'op2', 'op3'];
      
      operations.forEach(opType => {
        const op = domOptimizer.performanceMonitor.startOperation(opType);
        domOptimizer.performanceMonitor.endOperation(op);
      });
      
      const metrics = domOptimizer.performanceMonitor.getMetrics();
      expect(metrics.operationsCount).toBe(3);
      expect(metrics.averageTime).toBeGreaterThan(0);
    });

    test('resets metrics correctly', () => {
      const op = domOptimizer.performanceMonitor.startOperation('test');
      domOptimizer.performanceMonitor.endOperation(op);
      
      domOptimizer.performanceMonitor.reset();
      
      const metrics = domOptimizer.performanceMonitor.getMetrics();
      expect(metrics.operationsCount).toBe(0);
      expect(metrics.totalTime).toBe(0);
      expect(metrics.averageTime).toBe(0);
      expect(metrics.slowOperations).toHaveLength(0);
    });
  });

  describe('Utility Functions', () => {
    test('defers execution to next frame', async () => {
      let executed = false;
      
      domOptimizer.defer(() => {
        executed = true;
      });
      
      expect(executed).toBe(false);
      
      await new Promise(resolve => requestAnimationFrame(resolve));
      expect(executed).toBe(true);
    });

    test('measures performance of operations', () => {
      const result = domOptimizer.measurePerformance(() => {
        // Simulate work
        for (let i = 0; i < 1000; i++) {
          Math.random();
        }
        return 'operation-result';
      });
      
      expect(result.result).toBe('operation-result');
      expect(typeof result.duration).toBe('number');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Performance Requirements', () => {
    test('batch operations complete within frame budget', async () => {
      const operations = [];
      
      // Create many operations
      for (let i = 0; i < 100; i++) {
        const textNode = document.createTextNode(`Text ${i}`);
        mockElements.parent.appendChild(textNode);
        operations.push({
          type: 'replaceText',
          element: textNode,
          newText: `Updated ${i}`,
          parent: mockElements.parent
        });
      }
      
      const start = performance.now();
      operations.forEach(op => domOptimizer.batch.schedule(op));
      
      await new Promise(resolve => requestAnimationFrame(resolve));
      const duration = performance.now() - start;
      
      expect(duration).toBeLessThan(50); // Within reasonable time for test environment
    });

    test('element creation is fast', () => {
      const start = performance.now();
      
      for (let i = 0; i < 100; i++) {
        domOptimizer.createElement('div', {
          className: `element-${i}`,
          textContent: `Content ${i}`
        });
      }
      
      const duration = performance.now() - start;
      expect(duration).toBeLessThan(10); // Less than 10ms for 100 elements
    });

    test('text replacement scales linearly', () => {
      const textNodes = [];
      
      // Create test nodes
      for (let i = 0; i < 50; i++) {
        const node = document.createTextNode(`Original ${i}`);
        mockElements.parent.appendChild(node);
        textNodes.push(node);
      }
      
      const start = performance.now();
      
      textNodes.forEach((node, i) => {
        domOptimizer.replaceText(node, `Replaced ${i}`);
      });
      
      domOptimizer.executeBatch(true); // Use synchronous execution for performance test
      
      const duration = performance.now() - start;
      expect(duration).toBeLessThan(20); // Should scale well
    });
  });

  describe('Golden Test Scenarios', () => {
    // Golden Test 1: Complete page translation workflow
    test('GOLDEN: handles complete page translation workflow', async () => {
      // Simulate translation of multiple elements
      const translationPairs = [
        { element: mockElements.child1, original: 'Hello', translated: 'Hola' },
        { element: mockElements.child2, original: 'World', translated: 'Mundo' },
        { element: mockElements.textNode, original: 'Original text', translated: 'Texto original' }
      ];
      
      // Update original text
      translationPairs.forEach(({ element, original }) => {
        element.textContent = original;
      });
      
      // Batch translate
      const start = performance.now();
      
      translationPairs.forEach(({ element, translated }) => {
        if (element.nodeType === Node.TEXT_NODE) {
          domOptimizer.replaceText(element, translated, true);
        } else {
          domOptimizer.batch.schedule({
            type: 'replaceText',
            element: element.firstChild || element,
            newText: translated,
            parent: element
          });
        }
      });
      
      domOptimizer.executeBatch();
      await new Promise(resolve => requestAnimationFrame(resolve));
      
      const duration = performance.now() - start;
      
      // Verify translations
      expect(mockElements.child1.textContent).toBe('Hola');
      expect(mockElements.child2.textContent).toBe('Mundo'); 
      expect(mockElements.textNode.textContent).toBe('Texto original');
      
      // Performance requirement (adjusted for test environment)
      expect(duration).toBeLessThan(50);
      
      // Check performance metrics
      const metrics = domOptimizer.performanceMonitor.getMetrics();
      expect(metrics.operationsCount).toBeGreaterThan(0);
    });

    // Golden Test 2: Dynamic content handling
    test('GOLDEN: handles dynamic content updates efficiently', async () => {
      const container = domOptimizer.createElement('div', { id: 'dynamic-container' });
      document.body.appendChild(container);
      
      // Simulate streaming translation updates
      const streamingText = ['Hel', 'Hello', 'Hello Wor', 'Hello World'];
      
      for (const text of streamingText) {
        const textNode = document.createTextNode('');
        container.appendChild(textNode);
        
        domOptimizer.replaceText(textNode, text);
        domOptimizer.executeBatch();
        await new Promise(resolve => requestAnimationFrame(resolve));
        
        expect(textNode.textContent).toBe(text);
      }
      
      expect(container.childNodes.length).toBe(streamingText.length);
    });

    // Golden Test 3: Memory and performance optimization
    test('GOLDEN: maintains performance under memory pressure', async () => {
      const memoryTest = domOptimizer.measurePerformance(() => {
        // Create large DOM structure
        const fragment = document.createDocumentFragment();
        
        for (let i = 0; i < 1000; i++) {
          const element = domOptimizer.createElement('div', {
            className: `item-${i}`,
            textContent: `Item ${i}`,
            'data-index': i.toString()
          });
          fragment.appendChild(element);
        }
        
        // Use fragment for efficient append
        const container = domOptimizer.createElement('div', { id: 'memory-test' });
        container.appendChild(fragment);
        document.body.appendChild(container);
        
        return container.children.length;
      });
      
      expect(memoryTest.result).toBe(1000);
      expect(memoryTest.duration).toBeLessThan(100); // Should handle large structures efficiently
      
      // Verify DOM structure
      const container = document.getElementById('memory-test');
      expect(container.children.length).toBe(1000);
      expect(container.lastElementChild.textContent).toBe('Item 999');
    });

    // Edge Case 1: Concurrent batch operations
    test('EDGE CASE: handles concurrent batch operations', async () => {
      const textNodes = [];
      
      for (let i = 0; i < 20; i++) {
        const node = document.createTextNode(`Concurrent ${i}`);
        mockElements.parent.appendChild(node);
        textNodes.push(node);
      }
      
      // Start multiple batch operations concurrently
      const promises = textNodes.map((node, i) => 
        new Promise(resolve => {
          setTimeout(() => {
            domOptimizer.replaceText(node, `Updated ${i}`);
            resolve();
          }, Math.random() * 10);
        })
      );
      
      await Promise.all(promises);
      domOptimizer.executeBatch();
      await new Promise(resolve => requestAnimationFrame(resolve));
      
      // Verify all updates completed
      textNodes.forEach((node, i) => {
        expect(node.textContent).toBe(`Updated ${i}`);
      });
    });

    // Edge Case 2: Error recovery
    test('EDGE CASE: recovers from DOM operation errors', async () => {
      // Create invalid operation that should fail
      const invalidElement = document.createElement('div');
      // Don't append to document - should cause issues
      
      domOptimizer.batch.schedule({
        type: 'setAttribute',
        element: null, // Invalid element
        name: 'test',
        value: 'invalid'
      });
      
      domOptimizer.batch.schedule({
        type: 'replaceText',
        element: mockElements.textNode,
        newText: 'Should work',
        parent: mockElements.parent
      });
      
      // Should complete without throwing
      await new Promise(resolve => requestAnimationFrame(resolve));
      
      // Valid operation should still work
      expect(mockElements.textNode.textContent).toBe('Should work');
    });
  });
});
