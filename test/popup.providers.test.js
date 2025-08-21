// @jest-environment jsdom

describe('popup home:init includes provider usage', () => {
  let listener;
  beforeEach(() => {
    jest.resetModules();
    global.chrome = {
      runtime: {
        sendMessage: jest.fn((msg, cb) => {
          if (msg.action === 'metrics') {
            cb({
              usage: {},
              cache: {},
              tm: {},
              providers: {},
              providersUsage: { qwen: { requests: 1 } },
              status: {},
            });
          }
        }),
        onMessage: { addListener: fn => { listener = fn; } },
      },
      storage: { sync: { get: jest.fn((defaults, cb) => cb(defaults)) } },
    };
    require('../src/popup.js');
  });

  test('returns providers usage', async () => {
    const res = await new Promise(resolve => listener({ action: 'home:init' }, {}, resolve));
    expect(res.providers).toEqual({ qwen: { requests: 1 } });
  });
});
