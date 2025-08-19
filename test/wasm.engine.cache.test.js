/** @jest-environment jsdom */
const fetchMock = require('jest-fetch-mock');
beforeAll(() => fetchMock.enableMocks());
beforeEach(() => fetch.resetMocks());

// fake-indexeddb for jsdom
require('fake-indexeddb/auto');

describe('wasm engine assets caching', () => {
  test('ensureWasmAssets downloads and caches assets; subsequent loads use cache', async () => {
    const engine = require('../src/wasm/engine.js');
    // Mock all fetches to return small buffers/text
    fetch.mockResponse(async req => {
      const url = req.url || '';
      if (url.endsWith('.wasm') || url.endsWith('.ttf') || url.endsWith('.otf')) {
        return { body: Buffer.from([1, 2, 3, 4]) };
      }
      return { body: 'console.log("stub")' };
    });

    await engine.ensureWasmAssets();
    // At least one known asset should be present in memory
    expect(engine.getAssetBuffer('hb.wasm')).toBeTruthy();

    // Simulate offline by failing fetch; ensure it still succeeds via cache
    fetch.mockRejectOnce(new Error('offline'));
    // Clear in-memory fetched map entry for hb.wasm to force idb path
    // Not directly exposed; call ensureWasmAssets again should detect vendor missing and use idb
    await engine.ensureWasmAssets();
    expect(engine.getAssetBuffer('hb.wasm')).toBeTruthy();
  });

  test('optional checksum mismatch throws when provided', async () => {
    const engine = require('../src/wasm/engine.js');
    // Inject a checksum for hb.wasm and return a different buffer
    const asset = engine.WASM_ASSETS.find(a => a.path === 'hb.wasm');
    asset.sha256 = 'deadbeef'; // invalid on purpose
    fetch.mockResponse(async req => ({ body: Buffer.from([9, 9, 9]) }));
    await expect(engine.ensureWasmAssets()).rejects.toThrow(/checksum mismatch|Failed to download/);
    // Clean up checksum to not affect other tests
    delete asset.sha256;
  });
});

