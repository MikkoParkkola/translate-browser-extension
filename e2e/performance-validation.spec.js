/**
 * @fileoverview E2E performance validation tests
 * Verifies performance improvements in real browser environments
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const pageUrl = 'http://127.0.0.1:8080/e2e/mock.html';
const contentScript = fs.readFileSync(path.join(__dirname, '../src/contentScript.js'), 'utf8');
const memoryManager = fs.readFileSync(path.join(__dirname, '../src/core/memory-manager.js'), 'utf8');
const domOptimizer = fs.readFileSync(path.join(__dirname, '../src/core/dom-optimizer.js'), 'utf8');

test.describe('Performance Validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      // Mock Chrome APIs
      window.chrome = {
        runtime: {
          getURL: () => 'chrome-extension://test/',
          sendMessage: () => Promise.resolve({ success: true }),
          onMessage: { addListener: () => {} }
        },
        storage: {
          sync: {
            get: () => Promise.resolve({
              selectionPopup: true,
              apiKey: 'test-key',
              targetLanguage: 'es',
              sourceLanguage: 'auto',
              provider: 'mock'
            }),
            set: () => Promise.resolve()
          }
        }
      };

      // Mock translation function with realistic delay
      window.qwenTranslate = async ({ text }) => {
        await new Promise(resolve => setTimeout(resolve, 50)); // Simulate API delay
        return { text: text + ' [ES]' };
      };

      // Mock configuration loading
      window.qwenLoadConfig = async () => ({
        selectionPopup: true,
        apiKey: 'test-key',
        targetLanguage: 'es',
        sourceLanguage: 'auto',
        provider: 'mock',
        debug: false
      });

      // Performance monitoring setup
      window.performanceMetrics = {
        translationTimes: [],
        memoryUsage: [],
        domOperations: [],
        recordTranslation: (duration) => {
          window.performanceMetrics.translationTimes.push(duration);
        },
        recordMemory: (usage) => {
          window.performanceMetrics.memoryUsage.push(usage);
        },
        recordDOMOperation: (duration, nodeCount) => {
          window.performanceMetrics.domOperations.push({ duration, nodeCount });
        }
      };
    });

    await page.goto(pageUrl);
    
    // Load core modules
    await page.addScriptTag({ content: memoryManager });
    await page.addScriptTag({ content: domOptimizer });
    await page.addScriptTag({ content: contentScript });
    
    await page.waitForTimeout(100);
  });

  test('translation performance meets frame budget requirements', async ({ page }) => {
    // Create a large page with many text nodes
    await page.evaluate(() => {
      const content = [];
      for (let i = 0; i < 50; i++) {
        content.push(`
          <section class="content-section">
            <h3>Section ${i} - Important Heading</h3>
            <p>This is the first paragraph of section ${i} containing meaningful content that needs translation.</p>
            <p>This is the second paragraph with additional information and details for section ${i}.</p>
            <ul>
              <li>Important list item one for section ${i}</li>
              <li>Important list item two for section ${i}</li>
              <li>Important list item three for section ${i}</li>
            </ul>
            <blockquote>This is a quote from section ${i} that provides valuable insights.</blockquote>
          </section>
        `);
      }
      document.body.innerHTML = content.join('');
    });

    // Start performance measurement
    const startTime = await page.evaluate(() => performance.now());

    // Trigger translation
    await page.evaluate(async () => {
      const startTranslation = performance.now();
      
      // Collect all translatable text nodes (simulating content script)
      const textElements = document.querySelectorAll('h3, p, li, blockquote');
      const translationPairs = Array.from(textElements).map(element => ({
        element,
        original: element.textContent.trim(),
        translated: element.textContent.trim() + ' [ES]'
      }));

      // Use DOM optimizer for batch translation
      if (window.domOptimizer) {
        await window.domOptimizer.batchTranslate(translationPairs, {
          frameTarget: 16, // 60fps target
          batchSize: 20
        });
      }

      const endTranslation = performance.now();
      window.performanceMetrics.recordTranslation(endTranslation - startTranslation);
    });

    const endTime = await page.evaluate(() => performance.now());

    // Verify translations were applied
    const firstHeading = await page.textContent('h3');
    expect(firstHeading).toContain('[ES]');

    const firstParagraph = await page.textContent('p');
    expect(firstParagraph).toContain('[ES]');

    // Verify performance metrics
    const metrics = await page.evaluate(() => window.performanceMetrics);
    
    // Total translation time should be reasonable for 50 sections
    const totalTime = endTime - startTime;
    expect(totalTime).toBeLessThan(2000); // Less than 2 seconds total

    // Individual translation batches should meet frame budget
    if (metrics.translationTimes.length > 0) {
      metrics.translationTimes.forEach(time => {
        expect(time).toBeLessThan(100); // Each batch under 100ms
      });
    }
  });

  test('memory usage remains stable during continuous translation', async ({ page }) => {
    // Monitor memory usage over multiple translation cycles
    const memorySnapshots = [];

    for (let cycle = 0; cycle < 10; cycle++) {
      // Add new content
      await page.evaluate((cycleNum) => {
        const container = document.body;
        const newSection = document.createElement('section');
        newSection.className = `cycle-${cycleNum}`;
        newSection.innerHTML = `
          <h4>Cycle ${cycleNum} - Dynamic Content</h4>
          <p>This is paragraph content for cycle ${cycleNum}.</p>
          <div class="details">
            <span>Detail item 1 for cycle ${cycleNum}</span>
            <span>Detail item 2 for cycle ${cycleNum}</span>
            <span>Detail item 3 for cycle ${cycleNum}</span>
          </div>
        `;
        container.appendChild(newSection);
      }, cycle);

      // Translate new content
      await page.evaluate(async (cycleNum) => {
        const section = document.querySelector(`.cycle-${cycleNum}`);
        const textElements = section.querySelectorAll('h4, p, span');
        
        const translationPairs = Array.from(textElements).map(element => ({
          element,
          original: element.textContent.trim(),
          translated: element.textContent.trim() + ' [ES]'
        }));

        if (window.domOptimizer) {
          await window.domOptimizer.batchTranslate(translationPairs);
        }
      }, cycle);

      // Measure memory
      const memoryInfo = await page.evaluate(() => {
        if (performance.memory) {
          return {
            used: performance.memory.usedJSHeapSize,
            total: performance.memory.totalJSHeapSize,
            limit: performance.memory.jsHeapSizeLimit
          };
        }
        return null;
      });

      if (memoryInfo) {
        memorySnapshots.push(memoryInfo);
      }

      // Clean up old content (simulate SPA-like behavior)
      if (cycle >= 5) {
        await page.evaluate((cycleToRemove) => {
          const oldSection = document.querySelector(`.cycle-${cycleToRemove}`);
          if (oldSection) {
            if (window.memoryManager) {
              window.memoryManager.elementManager.cleanupElement(oldSection);
            }
            oldSection.remove();
          }
        }, cycle - 5);
      }

      await page.waitForTimeout(50);
    }

    // Analyze memory usage patterns
    if (memorySnapshots.length >= 5) {
      const initialMemory = memorySnapshots[0].used;
      const finalMemory = memorySnapshots[memorySnapshots.length - 1].used;
      const memoryGrowth = finalMemory - initialMemory;

      // Memory growth should be reasonable (less than 10MB)
      expect(memoryGrowth).toBeLessThan(10 * 1024 * 1024);

      // Memory should not continuously grow (should have cleanup)
      const midMemory = memorySnapshots[Math.floor(memorySnapshots.length / 2)].used;
      const memoryStabilized = Math.abs(finalMemory - midMemory) < (initialMemory * 0.5);
      expect(memoryStabilized).toBe(true);
    }
  });

  test('DOM manipulation performance with large batches', async ({ page }) => {
    // Create content with many nested elements
    await page.evaluate(() => {
      const container = document.createElement('div');
      container.className = 'performance-test-container';
      
      for (let i = 0; i < 100; i++) {
        const item = document.createElement('article');
        item.className = `article-${i}`;
        item.innerHTML = `
          <header>
            <h5>Article ${i} Title</h5>
            <time>2024-${(i % 12) + 1}-${(i % 28) + 1}</time>
          </header>
          <div class="content">
            <p>First paragraph of article ${i} with substantial content.</p>
            <p>Second paragraph of article ${i} with additional information.</p>
            <footer>
              <small>Article ${i} metadata and attribution.</small>
            </footer>
          </div>
        `;
        container.appendChild(item);
      }
      
      document.body.appendChild(container);
    });

    // Measure DOM operation performance
    const domPerformance = await page.evaluate(async () => {
      const startTime = performance.now();
      
      const articles = document.querySelectorAll('article');
      const textElements = [];
      
      articles.forEach(article => {
        const elements = article.querySelectorAll('h5, time, p, small');
        elements.forEach(el => textElements.push(el));
      });

      const translationPairs = textElements.map(element => ({
        element,
        original: element.textContent.trim(),
        translated: element.textContent.trim() + ' [ES]'
      }));

      window.performanceMetrics.recordDOMOperation(0, textElements.length);

      if (window.domOptimizer) {
        await window.domOptimizer.batchTranslate(translationPairs, {
          frameTarget: 16,
          batchSize: 30
        });
      }

      const endTime = performance.now();
      return {
        duration: endTime - startTime,
        elementCount: textElements.length,
        operations: window.performanceMetrics.domOperations
      };
    });

    // Verify performance meets requirements
    expect(domPerformance.elementCount).toBeGreaterThan(400); // Should handle many elements
    expect(domPerformance.duration).toBeLessThan(1000); // Should complete within 1 second
    
    // Each batch should be efficient
    const avgBatchTime = domPerformance.duration / Math.ceil(domPerformance.elementCount / 30);
    expect(avgBatchTime).toBeLessThan(50); // Average batch time under 50ms

    // Verify all translations applied
    const sampleTitle = await page.textContent('h5');
    expect(sampleTitle).toContain('[ES]');
    
    const sampleParagraph = await page.textContent('p');
    expect(sampleParagraph).toContain('[ES]');
  });

  test('responsive performance under different viewport sizes', async ({ page }) => {
    const viewports = [
      { width: 1920, height: 1080, name: 'desktop' },
      { width: 768, height: 1024, name: 'tablet' },
      { width: 375, height: 667, name: 'mobile' }
    ];

    const performanceResults = {};

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      
      // Create responsive content
      await page.evaluate(() => {
        document.body.innerHTML = `
          <div class="responsive-container">
            <header class="header">
              <h1>Responsive Translation Test</h1>
              <nav class="navigation">
                <a href="#home">Home</a>
                <a href="#about">About Us</a>
                <a href="#services">Our Services</a>
                <a href="#contact">Contact</a>
              </nav>
            </header>
            <main class="main-content">
              <section class="hero">
                <h2>Welcome to Our Platform</h2>
                <p>This is a comprehensive platform for all your needs.</p>
              </section>
              <section class="features">
                <div class="feature">
                  <h3>Feature One</h3>
                  <p>Description of the first amazing feature.</p>
                </div>
                <div class="feature">
                  <h3>Feature Two</h3>
                  <p>Description of the second incredible feature.</p>
                </div>
                <div class="feature">
                  <h3>Feature Three</h3>
                  <p>Description of the third outstanding feature.</p>
                </div>
              </section>
            </main>
            <footer class="footer">
              <p>Copyright 2024. All rights reserved.</p>
            </footer>
          </div>
        `;
      });

      // Measure translation performance at this viewport
      const viewportPerformance = await page.evaluate(async (viewportName) => {
        const startTime = performance.now();
        
        const textElements = document.querySelectorAll('h1, h2, h3, p, a');
        const translationPairs = Array.from(textElements).map(element => ({
          element,
          original: element.textContent.trim(),
          translated: element.textContent.trim() + ' [ES]'
        }));

        if (window.domOptimizer) {
          await window.domOptimizer.batchTranslate(translationPairs, {
            frameTarget: 16,
            viewport: viewportName
          });
        }

        const endTime = performance.now();
        return {
          duration: endTime - startTime,
          elementCount: textElements.length,
          viewport: viewportName
        };
      }, viewport.name);

      performanceResults[viewport.name] = viewportPerformance;

      // Verify translation worked
      const heading = await page.textContent('h1');
      expect(heading).toContain('[ES]');
    }

    // Verify performance consistency across viewports
    const desktopTime = performanceResults.desktop.duration;
    const tabletTime = performanceResults.tablet.duration;
    const mobileTime = performanceResults.mobile.duration;

    // Performance should be consistent across viewports (within 50% variance)
    expect(Math.abs(tabletTime - desktopTime)).toBeLessThan(desktopTime * 0.5);
    expect(Math.abs(mobileTime - desktopTime)).toBeLessThan(desktopTime * 0.5);

    // All should be reasonably fast
    expect(desktopTime).toBeLessThan(300);
    expect(tabletTime).toBeLessThan(300);
    expect(mobileTime).toBeLessThan(300);
  });

  test('concurrent translation requests maintain performance', async ({ page }) => {
    // Set up multiple content areas
    await page.evaluate(() => {
      document.body.innerHTML = `
        <div class="area-1">
          <h3>Area 1 Content</h3>
          <p>This is content for the first area.</p>
        </div>
        <div class="area-2">
          <h3>Area 2 Content</h3>
          <p>This is content for the second area.</p>
        </div>
        <div class="area-3">
          <h3>Area 3 Content</h3>
          <p>This is content for the third area.</p>
        </div>
      `;
    });

    // Fire concurrent translation requests
    const concurrentResults = await page.evaluate(async () => {
      const areas = document.querySelectorAll('[class^="area-"]');
      const startTime = performance.now();
      
      const translationPromises = Array.from(areas).map(async (area, index) => {
        const textElements = area.querySelectorAll('h3, p');
        const translationPairs = Array.from(textElements).map(element => ({
          element,
          original: element.textContent.trim(),
          translated: element.textContent.trim() + ` [ES-${index + 1}]`
        }));

        const areaStartTime = performance.now();
        
        if (window.domOptimizer) {
          await window.domOptimizer.batchTranslate(translationPairs, {
            requestId: `concurrent-${index + 1}`
          });
        }
        
        const areaEndTime = performance.now();
        return areaEndTime - areaStartTime;
      });

      const areaTimes = await Promise.all(translationPromises);
      const totalTime = performance.now() - startTime;
      
      return {
        totalTime,
        areaTimes,
        maxAreaTime: Math.max(...areaTimes),
        avgAreaTime: areaTimes.reduce((a, b) => a + b, 0) / areaTimes.length
      };
    });

    // Verify concurrent execution was efficient
    expect(concurrentResults.totalTime).toBeLessThan(500); // Total time reasonable
    expect(concurrentResults.maxAreaTime).toBeLessThan(200); // No area took too long
    
    // Verify all areas were translated
    const area1Content = await page.textContent('.area-1 h3');
    const area2Content = await page.textContent('.area-2 h3');
    const area3Content = await page.textContent('.area-3 h3');
    
    expect(area1Content).toContain('[ES-1]');
    expect(area2Content).toContain('[ES-2]');
    expect(area3Content).toContain('[ES-3]');
  });
});