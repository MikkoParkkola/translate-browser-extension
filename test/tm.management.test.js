// @jest-environment node

describe('TM management helpers', () => {
  beforeEach(() => {
    jest.resetModules();
    require('fake-indexeddb/auto');
  });

  test('getAll lists entries and clear removes them', async () => {
    const TM = require('../src/lib/tm.js');
    TM.__resetStats && TM.__resetStats();
    await TM.set('a', '1');
    await TM.set('b', '2');
    const all = await TM.getAll();
    expect(all.find(e => e.k === 'a').text).toBe('1');
    await TM.clear();
    const empty = await TM.getAll();
    expect(empty.length).toBe(0);
  });
});
