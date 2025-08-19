;(function(root){
  // Lightweight message schema and helpers for background/runtime messaging
  const MSG_VERSION = 1;

  const Actions = new Set([
    'translate','ping','get-usage-log','set-config','clear-remote-tm','tm-get-all','tm-clear','tm-import',
    'debug','usage','metrics','tm-cache-metrics','quota','detect','translation-status','get-status','get-stats',
    'recalibrate','ensure-start','home:init','home:get-usage','home:quick-translate','home:auto-translate','navigate',
  ]);

  function validateMessage(msg){
    const out = { ok:false, error:'', msg:null };
    if (!msg || typeof msg !== 'object') { out.error='invalid message'; return out; }
    const { action } = msg;
    if (typeof action !== 'string' || !Actions.has(action)) { out.error='invalid action'; return out; }
    // Shallow sanitize strings
    function sanitize(v){
      if (typeof v === 'string') return v.slice(0, 50000);
      if (Array.isArray(v)) return v.slice(0, 1000).map(sanitize);
      if (v && typeof v === 'object') {
        const o = {}; const keys = Object.keys(v).slice(0, 50);
        for (const k of keys) o[k] = sanitize(v[k]);
        return o;
      }
      return v;
    }
    const safe = sanitize(msg);
    out.ok = true; out.msg = safe; return out;
  }

  function withLastError(cb){
    return (...args)=>{
      try { const err = chrome.runtime.lastError; if (err && !String(err.message||'').includes('Receiving end')) console.debug(err); }
      catch {}
      if (typeof cb === 'function') cb(...args);
    };
  }

  function _uuid(){
    try { return (crypto && crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2); } catch { return String(Math.random()).slice(2); }
  }

  async function requestViaBackground({ onData, signal, ...opts }){
    const usePort = !!(root.chrome && root.chrome.runtime && typeof root.chrome.runtime.connect === 'function');
    if (usePort){
      const port = root.chrome.runtime.connect({ name: 'qwen-translate' });
      const requestId = _uuid();
      let done = false;
      let aborted = false;
      return new Promise((resolve, reject) => {
        const onMsg = (m) => {
          if (!m || m.requestId !== requestId) return;
          if (m.error) { done = true; try{port.disconnect();}catch{} reject(new Error(m.error)); }
          if (m.chunk && onData) { try { onData(m.chunk); } catch (e) { /* ignore consumer errors */ } }
          if (m.result){ done = true; try{port.disconnect();}catch{} resolve(m.result); }
        };
        const onDisc = () => { if (!done && !aborted) { reject(new Error('Port disconnected')); } };
        port.onMessage.addListener(onMsg);
        port.onDisconnect.addListener(onDisc);
        if (signal){
          if (signal.aborted){ try{ port.postMessage({ action: 'cancel', requestId }); } catch {};
            return reject(new DOMException('Aborted', 'AbortError')); }
          const abort = () => { aborted = true; try{ port.postMessage({ action: 'cancel', requestId }); } catch {};
            try { port.disconnect(); } catch {};
            reject(new DOMException('Aborted', 'AbortError')); };
          signal.addEventListener('abort', abort, { once: true });
        }
        port.postMessage({ action: 'translate', requestId, opts });
      });
    }
    return await new Promise((resolve, reject) => {
      try {
        root.chrome.runtime.sendMessage({ action: 'translate', opts }, withLastError(res => {
          if (!res) return reject(new Error('No response'));
          if (res.error) return reject(new Error(res.error));
          resolve(res);
        }));
      } catch (e) { reject(e); }
    });
  }

  async function detectLanguage({ sensitivity = 0, ...opts }){
    const usePort = !!(root.chrome && root.chrome.runtime && typeof root.chrome.runtime.connect === 'function');
    if (usePort){
      const port = root.chrome.runtime.connect({ name: 'qwen-translate' });
      const requestId = _uuid();
      return await new Promise((resolve, reject) => {
        const onMsg = (m) => {
          if (!m || m.requestId !== requestId) return;
          if (m.error) { try{port.disconnect();}catch{} return reject(new Error(m.error)); }
          if (m.result) {
            try{port.disconnect();}catch{}
            const r = m.result || {};
            if (typeof r.confidence === 'number' && r.confidence < sensitivity) return resolve({ lang: 'en', confidence: r.confidence });
            return resolve(r);
          }
        };
        port.onMessage.addListener(onMsg);
        port.onDisconnect.addListener(() => {});
        port.postMessage({ action: 'detect', requestId, opts });
      });
    }
    return await new Promise((resolve, reject) => {
      try {
        root.chrome.runtime.sendMessage({ action: 'detect', opts }, withLastError(res => {
          if (!res) return reject(new Error('No response'));
          const r = res || {};
          if (typeof r.confidence === 'number' && r.confidence < sensitivity) return resolve({ lang: 'en', confidence: r.confidence });
          resolve(r);
        }));
      } catch (e) { reject(e); }
    });
  }

  const api = { MSG_VERSION, validateMessage, withLastError, requestViaBackground, detectLanguage };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') root.qwenMessaging = Object.assign(root.qwenMessaging||{}, api);
  else if (typeof self !== 'undefined') self.qwenMessaging = Object.assign(self.qwenMessaging||{}, api);
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this));
