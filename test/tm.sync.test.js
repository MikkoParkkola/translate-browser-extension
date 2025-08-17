// @jest-environment node
require('fake-indexeddb/auto');

describe('TM remote sync', () => {
  beforeEach(() => {
    jest.resetModules();
    const data = {};
    global.chrome = {
      storage: {
        sync: {
          set: jest.fn((obj, cb) => { Object.assign(data, obj); cb && cb(); }),
          get: jest.fn((keys, cb) => {
            if (Array.isArray(keys)) { const out = {}; keys.forEach(k => out[k] = data[k]); cb(out); }
            else cb(data);
          }),
          remove: jest.fn((keys, cb) => { (Array.isArray(keys)?keys:[keys]).forEach(k => delete data[k]); cb && cb(); }),
        },
      },
    };
  });

  test('saves entries to chrome.storage.sync when enabled', async () => {
    const TM = require('../src/lib/tm.js');
    await TM.enableSync(true);
    await TM.set('k', 'v');
    const res = await new Promise(r => chrome.storage.sync.get(['qwen-tm'], r));
    expect(Array.isArray(res['qwen-tm'])).toBe(true);
    await TM.clearRemote();
    const after = await new Promise(r => chrome.storage.sync.get(['qwen-tm'], r));
    expect(after['qwen-tm']).toBeUndefined();
  });
});
