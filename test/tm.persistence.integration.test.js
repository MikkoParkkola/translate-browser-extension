// @jest-environment node
require('fake-indexeddb/auto');

describe('TM persistence with remote sync', () => {
  beforeEach(() => {
    jest.resetModules();
    const data = {};
    global.chrome = {
      storage: {
        sync: {
          set: jest.fn((obj, cb) => { Object.assign(data, obj); cb && cb(); }),
          get: jest.fn((keys, cb) => {
            if (Array.isArray(keys)) {
              const out = {}; keys.forEach(k => out[k] = data[k]); cb(out);
            } else cb(data);
          }),
          remove: jest.fn((keys, cb) => { (Array.isArray(keys)?keys:[keys]).forEach(k => delete data[k]); cb && cb(); }),
        },
      },
    };
  });

  test('restores entries after reload and keeps remote sync data', async () => {
    let TM = require('../src/lib/tm.js');
    await TM.enableSync(true);
    await TM.set('en:es:hello', 'hola');

    const before = await new Promise(r => chrome.storage.sync.get(['qwen-tm'], r));
    expect(before['qwen-tm'][0][0]).toBe('en:es:hello');
    expect(before['qwen-tm'][0][1].text).toBe('hola');

    jest.resetModules();
    TM = require('../src/lib/tm.js');
    await TM.enableSync(true);
    const res = await TM.get('en:es:hello');
    expect(res && res.text).toBe('hola');

    const after = await new Promise(r => chrome.storage.sync.get(['qwen-tm'], r));
    expect(after['qwen-tm'][0][0]).toBe('en:es:hello');
    expect(after['qwen-tm'][0][1].text).toBe('hola');
  });
});

