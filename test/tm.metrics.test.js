 // New file
 // @jest-environment node

 describe('TM metrics and observability', () => {
   beforeEach(() => {
     jest.resetModules();
     delete process.env.QWEN_TM_TTL;
     delete process.env.QWEN_TM_MAX;
     require('fake-indexeddb/auto');
   });

   test('counts hits, misses, sets', async () => {
     const TM = require('../src/lib/tm.js');
     TM.__resetStats && TM.__resetStats();

     const miss1 = await TM.get('x'); // miss
     await TM.set('x', 'vx');         // set
     const hit1 = await TM.get('x');  // hit

     expect(miss1).toBeNull();
     expect(hit1 && hit1.text).toBe('vx');

     const st = TM.stats && TM.stats();
     expect(st).toBeDefined();
     expect(st.misses).toBeGreaterThanOrEqual(1);
     expect(st.hits).toBeGreaterThanOrEqual(1);
     expect(st.sets).toBeGreaterThanOrEqual(1);
   });

   test('evictionsTTL increments on TTL prune', async () => {
     process.env.QWEN_TM_TTL = '10';
     process.env.QWEN_TM_MAX = '5000';

     const base = 1700002000000;
     const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => base);

     const TM = require('../src/lib/tm.js');
     TM.__resetStats && TM.__resetStats();

     await TM.set('k1', 'v1'); // ts = base
     nowSpy.mockImplementation(() => base + 50);
     await TM.set('k2', 'v2'); // triggers prune
     await new Promise(r => setTimeout(r, 20));

     const st = TM.stats();
     expect(st.evictionsTTL).toBeGreaterThan(0);

     nowSpy.mockRestore();
   });

   test('evictionsLRU increments when over max', async () => {
     process.env.QWEN_TM_TTL = '0';
     process.env.QWEN_TM_MAX = '1';

     const TM = require('../src/lib/tm.js');
     TM.__resetStats && TM.__resetStats();

     await TM.set('a', 'va');
     await TM.set('b', 'vb'); // should evict 'a'
     await new Promise(r => setTimeout(r, 20));

     const st = TM.stats();
     expect(st.evictionsLRU).toBeGreaterThan(0);
   });
 });
