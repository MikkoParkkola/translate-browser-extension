const { test, expect } = require('@playwright/test');

const pageUrl = 'http://127.0.0.1:8080/e2e/mock.html';

test('aborts streaming translation mid-stream', async ({ page }) => {
  await page.goto(pageUrl);
  const res = await page.evaluate(() => {
    return new Promise(async resolve => {
      window.qwenProviders.registerProvider('stream', {
        async translate({ text, onData, signal }) {
          const chunks = ['Bon', 'jour'];
          for (const chunk of chunks) {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            await new Promise(r => setTimeout(r, 100));
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            if (onData) onData(chunk);
          }
          return { text: 'Bonjour' };
        }
      });
      const controller = new AbortController();
      const pieces = [];
      window.qwenTranslateStream(
        { provider: 'stream', text: 'hello', source: 'en', target: 'fr', stream: true, signal: controller.signal },
        chunk => pieces.push(chunk)
      ).then(
        () => resolve({ error: null, chunks: pieces }),
        e => resolve({ error: e.name, chunks: pieces })
      );
      setTimeout(() => controller.abort(), 150);
    });
  });
  expect(res.error).toBe('AbortError');
  expect(res.chunks).toEqual(['Bon']);
});
