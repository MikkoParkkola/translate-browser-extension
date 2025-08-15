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

     nowSpy.mockRestore();
     delete process.env.QWEN_TM_TTL;
     delete process.env.QWEN_TM_MAX;
   });
 });
