/**
 * Tests for pdfjs-entry.ts
 *
 * This module is a thin re-export of pdfjs-dist used as a standalone chunk.
 * Tests verify the export shape matches what downstream consumers expect.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pdfjs-dist — the real package requires browser APIs (DOMMatrix, canvas)
// that are not available in the jsdom test environment.
vi.mock('pdfjs-dist', () => ({
  version: '4.10.38',
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: '' },
  renderTextLayer: vi.fn(),
  AnnotationLayer: vi.fn(),
  OPS: { dependency: 1, setLineWidth: 2 },
  PasswordResponses: { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 },
  shadow: vi.fn(),
  Util: { transform: vi.fn() },
  build: '1234abc',
}));

describe('pdfjs-entry', () => {
  let mod: typeof import('./pdfjs-entry');

  beforeEach(async () => {
    mod = await import('./pdfjs-entry');
  });

  // ------------------------------------------------------------------
  // Default export exists
  // ------------------------------------------------------------------
  it('has a default export', () => {
    expect(mod.default).toBeDefined();
  });

  it('default export is an object (namespace)', () => {
    expect(typeof mod.default).toBe('object');
    expect(mod.default).not.toBeNull();
  });

  // ------------------------------------------------------------------
  // Core API surface expected by consumers (pdf-loader.ts)
  // ------------------------------------------------------------------
  it('exposes getDocument function', () => {
    expect(typeof mod.default.getDocument).toBe('function');
  });

  it('exposes GlobalWorkerOptions', () => {
    expect(mod.default.GlobalWorkerOptions).toBeDefined();
    expect(mod.default.GlobalWorkerOptions).toHaveProperty('workerSrc');
  });

  it('exposes version string', () => {
    expect(typeof mod.default.version).toBe('string');
    expect(mod.default.version).toBe('4.10.38');
  });

  it('exposes renderTextLayer function', () => {
    expect(typeof mod.default.renderTextLayer).toBe('function');
  });

  it('exposes OPS enumeration', () => {
    expect(mod.default.OPS).toBeDefined();
    expect(typeof mod.default.OPS).toBe('object');
  });

  // ------------------------------------------------------------------
  // Identity — default export IS the pdfjs-dist namespace
  // ------------------------------------------------------------------
  it('default export is identical to the pdfjs-dist mock', async () => {
    const pdfjsDist = await import('pdfjs-dist');
    // The default export should be the namespace object itself
    expect(mod.default.version).toBe(pdfjsDist.version);
    expect(mod.default.getDocument).toBe(pdfjsDist.getDocument);
    expect(mod.default.GlobalWorkerOptions).toBe(pdfjsDist.GlobalWorkerOptions);
  });

  // ------------------------------------------------------------------
  // Module shape — no unexpected exports
  // ------------------------------------------------------------------
  it('module has default as the primary export', () => {
    expect(mod).toHaveProperty('default');
  });

  // ------------------------------------------------------------------
  // Downstream contract — GlobalWorkerOptions is mutable
  // ------------------------------------------------------------------
  it('GlobalWorkerOptions.workerSrc can be set', () => {
    mod.default.GlobalWorkerOptions.workerSrc = '/chunks/pdf.worker.min.mjs';
    expect(mod.default.GlobalWorkerOptions.workerSrc).toBe(
      '/chunks/pdf.worker.min.mjs',
    );
  });
});
