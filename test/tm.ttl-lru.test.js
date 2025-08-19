 // New file
 // @jest-environment node

 describe('TM TTL and LRU behavior', () => {
   beforeEach(() => {
     jest.resetModules();
   });

  test('TTL expiry removes old entries', async () => {
    process.env.QWEN_TM_TTL = '10'; // 10 ms
    process.env.QWEN_TM_MAX = '5000';
    require('fake-indexeddb/auto'); // enable indexedDB in Node

    const base = 1700000000000;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => base);

    const TM = require('../src/lib/tm.js');
    TM.__resetStats && TM.__resetStats();

    await TM.set('k1', 'v1'); // ts = base
    // advance time beyond TTL
    nowSpy.mockImplementation(() => base + 50);

    // Trigger prune via another set
    await TM.set('k2', 'v2');
    await new Promise(r => setTimeout(r, 15)); // allow async pruneDb to complete

    const v1 = await TM.get('k1');
    const v2 = await TM.get('k2');
    expect(v1).toBeNull();
    expect(v2).toEqual({ k: 'k2', text: 'v2', ts: expect.any(Number) });

    const st = TM.stats();
    expect(st.evictionsTTL).toBeGreaterThan(0);
    expect(st.evictionsLRU).toBe(0);

    nowSpy.mockRestore();
    delete process.env.QWEN_TM_TTL;
    delete process.env.QWEN_TM_MAX;
  });

  test('LRU evicts least recently used when over max', async () => {
    process.env.QWEN_TM_TTL = '0';   // disable TTL
    process.env.QWEN_TM_MAX = '2';   // keep only 2 entries
    require('fake-indexeddb/auto');

    const base = 1700001000000;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => base);

    const TM = require('../src/lib/tm.js');
    TM.__resetStats && TM.__resetStats();

    // Insert A, then B
    await TM.set('a', 'va'); // ts = base
    nowSpy.mockImplementation(() => base + 1);
    await TM.set('b', 'vb'); // ts = base+1

    // Access A to make it MRU
    nowSpy.mockImplementation(() => base + 2);
    await TM.get('a'); // refresh ts via background put
    await new Promise(r => setTimeout(r, 10)); // allow put to commit

    // Insert C to exceed max -> should evict B (LRU)
    nowSpy.mockImplementation(() => base + 3);
    await TM.set('c', 'vc');
    await new Promise(r => setTimeout(r, 15)); // allow pruneDb to complete

    const va = await TM.get('a');
    const vb = await TM.get('b');
    const vc = await TM.get('c');

    expect(va && va.text).toBe('va');
    expect(vb).toBeNull(); // evicted
    expect(vc && vc.text).toBe('vc');

    const st = TM.stats();
    expect(st.evictionsLRU).toBeGreaterThan(0);
    expect(st.evictionsTTL).toBe(0);

    nowSpy.mockRestore();
    delete process.env.QWEN_TM_TTL;
    delete process.env.QWEN_TM_MAX;
  });

  test('expired entries pruned before LRU eviction', async () => {
    process.env.QWEN_TM_TTL = '10';
    process.env.QWEN_TM_MAX = '2';
    require('fake-indexeddb/auto');

    const base = 1700002000000;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => base);

    const TM = require('../src/lib/tm.js');
    TM.__resetStats && TM.__resetStats();

    await TM.set('a', 'va'); // t0
    nowSpy.mockImplementation(() => base + 1);
    await TM.set('b', 'vb'); // t0+1

    // advance beyond TTL so a/b expire
    nowSpy.mockImplementation(() => base + 50);
    await TM.set('c', 'vc'); // triggers prune of a/b
    await new Promise(r => setTimeout(r, 20));

    nowSpy.mockImplementation(() => base + 51);
    await TM.set('d', 'vd');
    nowSpy.mockImplementation(() => base + 52);
    await TM.set('e', 've'); // should evict c (LRU)
    await new Promise(r => setTimeout(r, 20));

    const entries = await TM.getAll();
    expect(entries.map(e => e.k).sort()).toEqual(['d', 'e']);

    const st = TM.stats();
    expect(st.evictionsTTL).toBeGreaterThanOrEqual(2);
    expect(st.evictionsLRU).toBeGreaterThanOrEqual(1);

    nowSpy.mockRestore();
    delete process.env.QWEN_TM_TTL;
    delete process.env.QWEN_TM_MAX;
  });
});
