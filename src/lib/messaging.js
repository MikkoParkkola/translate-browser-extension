(function (root, factory) {
  const mod = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.qwenMessaging = mod;
}(typeof self !== 'undefined' ? self : this, function (root) {
  const logger = (root.qwenLogger && root.qwenLogger.create) ? root.qwenLogger.create('messaging') : console;
  function requestViaBackground({ endpoint, apiKey, model, secondaryModel, text, source, target, debug, stream = false, signal, onData, onStream, provider, providerOrder, endpoints, failover, parallel }) {
    if (!(root.chrome && root.chrome.runtime)) return Promise.reject(new Error('No chrome.runtime'));
    const ep = endpoint && /\/$/.test(endpoint) ? endpoint : (endpoint ? endpoint + '/' : endpoint);
    if (root.chrome.runtime.connect) {
      const requestId = Math.random().toString(36).slice(2);
      const port = root.chrome.runtime.connect({ name: 'qwen-translate' });
      return new Promise((resolve, reject) => {
        let settled = false;
        const onAbort = () => {
          if (!settled) {
            settled = true;
            reject(new DOMException('Aborted', 'AbortError'));
          }
          try { port.postMessage({ action: 'cancel', requestId }); } catch {}
          try { port.disconnect(); } catch {}
        };
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
        port.onMessage.addListener(msg => {
          if (!msg || msg.requestId !== requestId) return;
          if (msg.error) {
            try { port.disconnect(); } catch {}
            if (!settled) { settled = true; reject(new Error(msg.error)); }
            return;
          }
          if (typeof msg.interim === 'string' && typeof onStream === 'function') {
            try { onStream(msg.interim); } catch (e) { logger.warn('onStream error', e); }
          }
          if (typeof msg.chunk === 'string' && typeof onData === 'function') {
            try { onData(msg.chunk); } catch (e) { logger.warn('onData error', e); }
          }
          if (msg.result) {
            if (!settled) { settled = true; resolve(msg.result); }
            try { port.disconnect(); } catch {}
          }
        });
        port.onDisconnect.addListener(() => {
          if (!settled) { settled = true; reject(new Error('Background disconnected')); }
        });
        port.postMessage({ action: 'translate', requestId, opts: { endpoint: ep, apiKey, model, secondaryModel, text, source, target, debug, stream, provider, providerOrder, endpoints, failover, parallel } });
      });
    }
    // Legacy sendMessage (non-streaming)
    return new Promise((resolve, reject) => {
      try {
        root.chrome.runtime.sendMessage(
          { action: 'translate', opts: { endpoint: ep, apiKey, model, secondaryModel, text, source, target, debug, provider, providerOrder, endpoints, failover, parallel } },
          res => {
            if (root.chrome.runtime.lastError) reject(new Error(root.chrome.runtime.lastError.message));
            else if (!res) reject(new Error('No response from background'));
            else if (res.error) reject(new Error(res.error));
            else resolve(res);
          }
        );
      } catch (err) { reject(err); }
    });
  }
  function detectLanguage({ text, detector = 'local', debug, sensitivity = 0 }) {
    if (!(root.chrome && root.chrome.runtime)) return Promise.reject(new Error('No chrome.runtime'));
    if (root.chrome.runtime.connect) {
      const requestId = Math.random().toString(36).slice(2);
      const port = root.chrome.runtime.connect({ name: 'qwen-translate' });
      return new Promise((resolve, reject) => {
        let settled = false;
        const onMsg = (msg) => {
          if (!msg || msg.requestId !== requestId) return;
          if (msg.error) {
            try { port.disconnect(); } catch {}
            if (!settled) { settled = true; reject(new Error(msg.error)); }
            return;
          }
          if (msg.result) {
            try { port.disconnect(); } catch {}
            if (!settled) {
              const r = msg.result || {};
              const ok = typeof r.confidence === 'number' ? r.confidence >= sensitivity : true;
              settled = true;
              resolve(ok ? r : { lang: 'en', confidence: r.confidence || 0 });
            }
          }
        };
        port.onMessage.addListener(onMsg);
        port.onDisconnect.addListener(() => {
          if (!settled) { settled = true; reject(new Error('Background disconnected')); }
        });
        port.postMessage({ action: 'detect', requestId, opts: { text, detector, debug } });
      });
    }
    return new Promise((resolve, reject) => {
      try {
        root.chrome.runtime.sendMessage(
          { action: 'detect', opts: { text, detector, debug } },
          res => {
            if (root.chrome.runtime.lastError) reject(new Error(root.chrome.runtime.lastError.message));
            else if (!res) reject(new Error('No response from background'));
            else if (res.error) reject(new Error(res.error));
            else {
              const ok = typeof res.confidence === 'number' ? res.confidence >= sensitivity : true;
              resolve(ok ? res : { lang: 'en', confidence: res.confidence || 0 });
            }
          }
        );
      } catch (err) { reject(err); }
    });
  }

  return { requestViaBackground, detectLanguage };
}));
