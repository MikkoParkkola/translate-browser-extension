// @jest-environment node
require('fake-indexeddb/auto');

describe('TM persistence across sessions', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('restores entries from previous session', async () => {
    let TM = require('../src/lib/tm.js');
    await TM.set('en:es:hello', 'hola');
    jest.resetModules();
    TM = require('../src/lib/tm.js');
    const res = await TM.get('en:es:hello');
    expect(res && res.text).toBe('hola');
  });
});
