/**
 * Tests for pdfjs-entry.ts
 *
 * This module is a thin re-export of pdfjs-dist used as a standalone chunk.
 * Tests verify the export shape matches what pdfjs-dist provides.
 */

import { describe, it, expect, vi } from 'vitest';

// pdfjs-dist is a heavy native package — mock it for unit testing
vi.mock('pdfjs-dist', () => ({
  version: '4.0.0',
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: '' },
  renderTextLayer: vi.fn(),
  OPS: {},
}));

describe('pdfjs-entry', () => {
  it('exports pdfjs-dist as default export', async () => {
    const mod = await import('./pdfjs-entry');
    expect(mod.default).toBeDefined();
  });

  it('default export has version property from pdfjs-dist', async () => {
    const mod = await import('./pdfjs-entry');
    expect(mod.default.version).toBe('4.0.0');
  });

  it('default export exposes getDocument function', async () => {
    const mod = await import('./pdfjs-entry');
    expect(typeof mod.default.getDocument).toBe('function');
  });

  it('default export exposes GlobalWorkerOptions', async () => {
    const mod = await import('./pdfjs-entry');
    expect(mod.default.GlobalWorkerOptions).toBeDefined();
  });
});
