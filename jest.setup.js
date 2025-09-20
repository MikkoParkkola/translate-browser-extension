const fetchMock = require('jest-fetch-mock');
fetchMock.enableMocks();

// Minimal chrome stub so modules under test can register listeners without blowing up
global.chrome = {
  runtime: {
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    onConnect: { addListener: () => {} },
    onMessage: { addListener: () => {} },
    sendMessage: jest.fn(() => {}),
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
      set: jest.fn((_o, cb) => cb && cb()),
    },
  },
  tabs: { query: (_i, cb) => cb && cb([]), sendMessage: () => {}, onUpdated: { addListener: () => {} } },
  contextMenus: { removeAll: (cb)=>cb&&cb(), create: ()=>{}, onClicked: { addListener: ()=>{} } },
  action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {}, setIcon: () => {} },
};

if (typeof global.structuredClone !== 'function') {
  global.structuredClone = obj => {
    try { return JSON.parse(JSON.stringify(obj)); } catch { return obj; }
  };
}

// Canvas/OffscreenCanvas stubs
if (typeof global.OffscreenCanvas === 'undefined') {
  global.OffscreenCanvas = function (w, h) {
    this.width = w; this.height = h;
    this._ctx = {
      clearRect: () => {},
      beginPath: () => {},
      arc: () => {},
      stroke: () => {},
      fill: () => {},
      fillText: () => {},
      getImageData: () => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      set lineWidth(v) {},
      set strokeStyle(v) {},
      set fillStyle(v) {},
      font: '',
      textAlign: '',
      textBaseline: ''
    };
    this.getContext = () => this._ctx;
  };
}

// Provide a canvas element fallback with a 2D context in jsdom
if (typeof document !== 'undefined') {
  const origCreate = document.createElement.bind(document);
  document.createElement = function (tagName) {
    const el = origCreate(tagName);
    if (String(tagName).toLowerCase() === 'canvas') {
      el.getContext = () => ({
        clearRect: () => {},
        beginPath: () => {},
        arc: () => {},
        stroke: () => {},
        fill: () => {},
        fillText: () => {},
        getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
        set lineWidth(v) {},
        set strokeStyle(v) {},
        set fillStyle(v) {},
        font: '', textAlign: '', textBaseline: ''
      });
    }
    return el;
  };
}

// Ensure crypto.subtle is available for all tests
if (typeof global.crypto === 'undefined' || !global.crypto.subtle) {
  global.crypto = {
    subtle: {
      importKey: jest.fn().mockResolvedValue({}),
      deriveKey: jest.fn().mockResolvedValue({}),
      encrypt: jest.fn().mockResolvedValue(new ArrayBuffer(16)),
      decrypt: jest.fn().mockResolvedValue(new ArrayBuffer(16))
    },
    getRandomValues: jest.fn().mockReturnValue(new Uint8Array(16)),
    randomUUID: jest.fn().mockReturnValue('test-uuid-1234')
  };
}
