const fetchMock = require('jest-fetch-mock');
fetchMock.enableMocks();

// Minimal chrome stub so modules under test can register listeners without blowing up
global.chrome = {
  runtime: {
    onConnect: { addListener: () => {} },
    onMessage: { addListener: () => {} },
    sendMessage: () => {},
    getURL: p => p,
  },
  storage: {
    local: {
      get: (keys, cb) => {
        const out = {};
        if (Array.isArray(keys)) {
          keys.forEach(k => {
            const v = localStorage.getItem(k);
            out[k] = v ? JSON.parse(v) : undefined;
          });
        } else if (typeof keys === 'string') {
          const v = localStorage.getItem(keys);
          out[keys] = v ? JSON.parse(v) : undefined;
        } else {
          Object.keys(keys || {}).forEach(k => {
            const v = localStorage.getItem(k);
            out[k] = v ? JSON.parse(v) : keys[k];
          });
        }
        cb && cb(out);
      },
      set: (obj, cb) => {
        Object.keys(obj || {}).forEach(k => {
          localStorage.setItem(k, JSON.stringify(obj[k]));
        });
        cb && cb();
      },
      remove: (keys, cb) => {
        (Array.isArray(keys) ? keys : [keys]).forEach(k => localStorage.removeItem(k));
        cb && cb();
      },
    },
    sync: {
      get: (d, cb) => cb && cb(d),
      set: (_o, cb) => cb && cb(),
    },
  },
  tabs: { query: (_i, cb) => cb && cb([]), sendMessage: () => {}, onUpdated: { addListener: () => {} } },
  action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {}, setIcon: () => {} },
};

if (typeof global.structuredClone !== 'function') {
  global.structuredClone = obj => {
    try { return JSON.parse(JSON.stringify(obj)); } catch { return obj; }
  };
}
