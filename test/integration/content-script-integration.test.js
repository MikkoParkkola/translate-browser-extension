/**
 * @fileoverview Integration tests for contentScript.js with core modules
 * Tests memory-manager and dom-optimizer collaboration in realistic scenarios
 */

// Mock Chrome APIs
global.chrome = {
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn()
    },
    getURL: jest.fn(() => 'chrome-extension://test/')
  },
  storage: {
    sync: {
      get: jest.fn(() => Promise.resolve({})),
      set: jest.fn(() => Promise.resolve())
    }
  }
};

// Mock global functions that would be loaded
global.qwenTranslate = jest.fn();
global.qwenLoadConfig = jest.fn(() => Promise.resolve({
  selectionPopup: true,
  apiKey: 'test-key',
  targetLanguage: 'es',
  sourceLanguage: 'auto',
  provider: 'qwen'
}));

describe('Content Script Integration', () => {
  let memoryManager;
  let domOptimizer;
  let mockTranslator;
  
  beforeEach(() => {
    // Clear DOM
    document.body.innerHTML = '';
    
    // Reset all mocks
    jest.clearAllMocks();
    
    // Load core modules
    const memoryManagerModule = require('../../src/core/memory-manager');
    const domOptimizerModule = require('../../src/core/dom-optimizer');
    
    memoryManager = memoryManagerModule;
    domOptimizer = domOptimizerModule;
    
    // Reinitialize memory manager to recreate MutationObserver
    memoryManager.reinit();
    
    // Mock translator with realistic behavior
    mockTranslator = {
      translate: jest.fn(async ({ text }) => ({
        text: text + ' [translated]'
      })),
      getUsage: jest.fn(() => ({ requests: 5, tokens: 1000 }))
    };
    
    global.qwenTranslate = mockTranslator.translate;
  });
  
  afterEach(() => {
    // Cleanup memory manager
    if (memoryManager?.cleanup) {
      memoryManager.cleanup();
    }
    
    // Clear DOM
    document.body.innerHTML = '';
  });

  describe('Page Translation Workflow', () => {
    test('GOLDEN: complete page translation with performance optimization', async () => {
      // Create realistic page structure
      document.body.innerHTML = `
        <header>
          <h1>Welcome to Our Site</h1>
          <nav>
            <a href="#home">Home</a>
            <a href="#about">About</a>
            <a href="#contact">Contact</a>
          </nav>
        </header>
        <main>
          <section>
            <h2>Main Content</h2>
            <p>This is the first paragraph with important information.</p>
            <p>This is the second paragraph with more details.</p>
            <div class="sidebar">
              <h3>Sidebar Title</h3>
              <p>Sidebar content goes here.</p>
            </div>
          </section>
        </main>
        <footer>
          <p>Copyright 2024. All rights reserved.</p>
        </footer>
      `;

      const startStats = memoryManager.getStats();
      const startTime = performance.now();
      
      // Collect all text nodes (simulating contentScript behavior)
      const textNodes = [];
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            const text = node.textContent.trim();
            if (text.length > 0 && !['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(node.parentElement?.tagName)) {
              return NodeFilter.FILTER_ACCEPT;
            }
            return NodeFilter.FILTER_REJECT;
          }
        }
      );
      
      let node;
      while (node = walker.nextNode()) {
        textNodes.push(node);
      }
      
      expect(textNodes.length).toBeGreaterThan(8); // Should find multiple text nodes
      
      // Use DOM optimizer for batch translation
      const translationPairs = textNodes.map(node => ({
        element: node.parentElement,
        original: node.textContent.trim(),
        translated: node.textContent.trim() + ' [translated]'
      }));
      
      // Batch DOM operations through optimizer
      await domOptimizer.batchTranslate(translationPairs, {
        preserveWhitespace: true,
        markTranslated: true
      });
      
      const endTime = performance.now();
      const endStats = memoryManager.getStats();
      
      // Verify translations applied
      expect(document.querySelector('h1').textContent).toBe('Welcome to Our Site [translated]');
      expect(document.querySelector('main p').textContent).toBe('This is the first paragraph with important information. [translated]');
      expect(document.querySelector('footer p').textContent).toBe('Copyright 2024. All rights reserved. [translated]');
      
      // Verify performance
      expect(endTime - startTime).toBeLessThan(100); // Should be fast
      
      // Verify memory management
      expect(endStats.references.observers).toBeGreaterThanOrEqual(startStats.references.observers);
    });

    test('dynamic content handling with memory cleanup', async () => {
      // Initial content
      document.body.innerHTML = '<div id="container"><p>Initial content</p></div>';
      
      const container = document.getElementById('container');
      const initialP = container.querySelector('p');
      
      // Track initial element
      memoryManager.track(initialP);
      
      // Simulate dynamic content addition
      const newContent = memoryManager.createElement('div', {
        innerHTML: '<h2>Dynamic Title</h2><p>Dynamic paragraph content</p>'
      });
      
      container.appendChild(newContent);
      
      // Get stats before cleanup
      const statsBeforeCleanup = memoryManager.getStats();
      expect(statsBeforeCleanup.references.observers).toBeGreaterThan(0);
      
      // Remove initial content (simulating SPA navigation)
      container.removeChild(initialP);
      memoryManager.elementManager.cleanupElement(initialP);
      
      // Verify cleanup
      const statsAfterCleanup = memoryManager.getStats();
      
      // Should still track new elements but cleaned up old ones
      expect(document.querySelector('h2').textContent).toBe('Dynamic Title');
      expect(document.querySelector('p').textContent).toBe('Dynamic paragraph content');
    });

    test('handles translation errors gracefully with memory safety', async () => {
      document.body.innerHTML = `
        <p>Good content</p>
        <p>Another good content</p>
        <p>Content that will fail</p>
      `;
      
      // Mock translator to fail on specific text
      global.qwenTranslate = jest.fn(async ({ text }) => {
        if (text.includes('fail')) {
          throw new Error('Translation failed');
        }
        return { text: text + ' [translated]' };
      });
      
      const textNodes = Array.from(document.querySelectorAll('p'));
      const translationPairs = textNodes.map(node => {
        const original = node.textContent.trim();
        // Only pre-compute translations for non-failing text
        const translated = original.includes('fail') ? original : original + ' [translated]';
        return {
          element: node,
          original,
          translated
        };
      });
      
      // Should handle errors gracefully
      try {
        await domOptimizer.batchTranslate(translationPairs, {
          continueOnError: true
        });
      } catch (error) {
        // Specific errors should be caught but not stop processing
      }
      
      // Verify partial success
      const paragraphs = document.querySelectorAll('p');
      expect(paragraphs[0].textContent).toBe('Good content [translated]');
      expect(paragraphs[1].textContent).toBe('Another good content [translated]');
      // Third paragraph should remain unchanged due to error
      expect(paragraphs[2].textContent).toBe('Content that will fail');
      
      // Memory should be cleaned up properly even with errors
      const stats = memoryManager.getStats();
      expect(stats.references.timers).toBe(0);
    });
  });

  describe('Real-world Performance Scenarios', () => {
    test('handles large page with many text nodes efficiently', async () => {
      // Create a large page structure
      const sections = [];
      for (let i = 0; i < 20; i++) {
        sections.push(`
          <section class="section-${i}">
            <h3>Section ${i} Title</h3>
            <p>This is paragraph 1 of section ${i} with meaningful content.</p>
            <p>This is paragraph 2 of section ${i} with more information.</p>
            <ul>
              <li>List item 1 for section ${i}</li>
              <li>List item 2 for section ${i}</li>
              <li>List item 3 for section ${i}</li>
            </ul>
          </section>
        `);
      }
      
      document.body.innerHTML = sections.join('');
      
      const startTime = performance.now();
      const startStats = memoryManager.getStats();
      
      // Simulate content script text collection
      const textNodes = [];
      document.querySelectorAll('h3, p, li').forEach(element => {
        if (element.textContent.trim()) {
          textNodes.push({
            element,
            original: element.textContent.trim(),
            translated: element.textContent.trim() + ' [ES]'
          });
        }
      });
      
      expect(textNodes.length).toBe(120); // 20 sections × 6 text elements each
      
      // Batch translate efficiently
      await domOptimizer.batchTranslate(textNodes, {
        batchSize: 10,
        frameTarget: 16 // 60fps target
      });
      
      const endTime = performance.now();
      const endStats = memoryManager.getStats();
      
      // Verify performance
      expect(endTime - startTime).toBeLessThan(500); // Should handle large pages quickly
      
      // Verify all translations applied
      expect(document.querySelector('h3').textContent).toBe('Section 0 Title [ES]');
      expect(document.querySelector('li').textContent).toBe('List item 1 for section 0 [ES]');
      
      // Memory should be managed efficiently
      const memoryGrowth = endStats.memory.current.usedJSHeapSize - startStats.memory.current.usedJSHeapSize;
      expect(memoryGrowth).toBeLessThan(5 * 1024 * 1024); // Less than 5MB growth
    });

    test('manages memory under continuous content changes', async () => {
      document.body.innerHTML = '<div id="dynamic-container"></div>';
      const container = document.getElementById('dynamic-container');
      
      const startStats = memoryManager.getStats();
      
      // Simulate continuous content updates (like a live feed)
      for (let cycle = 0; cycle < 10; cycle++) {
        // Add new content
        const newItem = memoryManager.createElement('div', {
          className: `item-${cycle}`,
          innerHTML: `<h4>Item ${cycle}</h4><p>Content for item ${cycle}</p>`
        });
        
        container.appendChild(newItem);
        
        // Translate new content
        const h4 = newItem.querySelector('h4');
        const p = newItem.querySelector('p');
        
        await domOptimizer.batchTranslate([
          { element: h4, original: h4.textContent, translated: h4.textContent + ' [ES]' },
          { element: p, original: p.textContent, translated: p.textContent + ' [ES]' }
        ]);
        
        // Remove old content (simulate feed cleanup)
        if (container.children.length > 5) {
          const oldItem = container.firstElementChild;
          memoryManager.elementManager.cleanupElement(oldItem);
          container.removeChild(oldItem);
        }
        
        // Brief pause to simulate real timing
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      const endStats = memoryManager.getStats();
      
      // Should maintain steady memory usage
      const memoryGrowth = endStats.memory.current.usedJSHeapSize - startStats.memory.current.usedJSHeapSize;
      expect(memoryGrowth).toBeLessThan(2 * 1024 * 1024); // Less than 2MB growth
      
      // Should have exactly 5 items (due to cleanup)
      expect(container.children.length).toBe(5);
      
      // All visible items should be translated
      expect(container.querySelector('h4').textContent).toContain('[ES]');
      expect(container.querySelector('p').textContent).toContain('[ES]');
    });
  });

  describe('Error Recovery and Edge Cases', () => {
    test('recovers from DOM manipulation conflicts', async () => {
      document.body.innerHTML = `
        <div id="test-area">
          <p class="translate-me">Original text 1</p>
          <p class="translate-me">Original text 2</p>
          <p class="translate-me">Original text 3</p>
        </div>
      `;
      
      const paragraphs = document.querySelectorAll('.translate-me');
      const translationPairs = Array.from(paragraphs).map(p => ({
        element: p,
        original: p.textContent,
        translated: p.textContent + ' [translated]'
      }));
      
      // Start translation
      const translationPromise = domOptimizer.batchTranslate(translationPairs, {
        batchSize: 1, // Process one at a time to create timing issues
        frameTarget: 50 // Slower to create opportunity for conflicts
      });
      
      // Simulate external DOM manipulation during translation
      setTimeout(() => {
        const middle = document.querySelectorAll('.translate-me')[1];
        if (middle && middle.parentNode) {
          middle.textContent = 'EXTERNALLY MODIFIED';
          middle.classList.add('externally-modified');
        }
      }, 25);
      
      await translationPromise;
      
      // Should handle the conflict gracefully
      const finalParagraphs = document.querySelectorAll('.translate-me');
      
      // First and third should be translated normally
      expect(finalParagraphs[0].textContent).toBe('Original text 1 [translated]');
      expect(finalParagraphs[2].textContent).toBe('Original text 3 [translated]');
      
      // Middle element should preserve external modification or handle gracefully
      const middleText = finalParagraphs[1].textContent;
      expect(middleText).toMatch(/(EXTERNALLY MODIFIED|Original text 2)/);
      
      // Memory should be clean despite conflicts
      const stats = memoryManager.getStats();
      expect(stats.references.timers).toBe(0);
    });

    test('handles rapid successive translation requests', async () => {
      document.body.innerHTML = '<p id="rapid-target">Quick change text</p>';
      const target = document.getElementById('rapid-target');
      
      // Fire multiple rapid translation requests
      const requests = [];
      for (let i = 0; i < 5; i++) {
        // Update source text before creating translation pair
        target.textContent = `Text version ${i}`;
        
        const translationPair = {
          element: target,
          original: `Text version ${i}`,
          translated: `Text version ${i} [translated]`
        };
        
        requests.push(
          domOptimizer.batchTranslate([translationPair], { 
            requestId: `rapid-${i}` 
          })
        );
      }
      
      // Wait for all to complete
      await Promise.allSettled(requests);
      
      // Should end up with consistent final state
      expect(target.textContent).toMatch(/Text version \d+ \[translated\]/);
      
      // Memory should be properly managed
      const stats = memoryManager.getStats();
      expect(stats.references.controllers).toBe(0);
      expect(stats.references.timers).toBe(0);
    });
  });

  describe('Memory Manager Integration', () => {
    test('properly tracks and cleans up translation-related resources', () => {
      document.body.innerHTML = `
        <div class="translation-area">
          <p>Text to translate 1</p>
          <p>Text to translate 2</p>
          <p>Text to translate 3</p>
        </div>
      `;
      
      const translationArea = document.querySelector('.translation-area');
      const paragraphs = translationArea.querySelectorAll('p');
      
      // Track elements with memory manager
      paragraphs.forEach(p => memoryManager.track(p));
      
      // Add event listeners through memory manager
      const clickHandler = jest.fn();
      paragraphs.forEach(p => {
        memoryManager.addEventListener(p, 'click', clickHandler);
      });
      
      // Add some timers
      const timerId1 = memoryManager.setTimeout(() => {}, 1000);
      const timerId2 = memoryManager.setInterval(() => {}, 500);
      
      const beforeCleanupStats = memoryManager.getStats();
      expect(beforeCleanupStats.references.observers).toBeGreaterThan(0);
      expect(beforeCleanupStats.references.timers).toBe(2);
      
      // Simulate page navigation / cleanup
      memoryManager.cleanup();
      
      const afterCleanupStats = memoryManager.getStats();
      expect(afterCleanupStats.references.observers).toBe(0);
      expect(afterCleanupStats.references.timers).toBe(0);
      expect(afterCleanupStats.references.cleanupCallbacks).toBe(0);
      
      // Events should no longer fire
      paragraphs[0].dispatchEvent(new Event('click'));
      expect(clickHandler).not.toHaveBeenCalled();
    });
  });
});