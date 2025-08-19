// @jest-environment node
require('fake-indexeddb/auto');

describe('TM remote sync', () => {
  beforeEach(() => {
    jest.resetModules();
    const data = {
      'qwen-tm': [['remote', { text: 'rv', ts: 1 }]],
    };
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

  test('loads, saves, and clears via chrome.storage.sync', async () => {
    const TM = require('../src/lib/tm.js');
    TM.__resetStats && TM.__resetStats();

    await TM.enableSync(true);
    expect(chrome.storage.sync.get).toHaveBeenCalled();

    const loaded = await TM.get('remote');
    expect(loaded && loaded.text).toBe('rv');

    let st = TM.stats();
    expect(st.hits).toBe(1);

    await TM.set('k', 'v');
    expect(chrome.storage.sync.set).toHaveBeenCalled();

    st = TM.stats();
    expect(st.sets).toBeGreaterThan(0);

    await TM.clearRemote();
    expect(chrome.storage.sync.remove).toHaveBeenCalled();
  });
});
