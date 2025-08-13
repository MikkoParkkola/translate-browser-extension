;(function (root) {
  if (root.qwenTransport) return;
  var runWithRetry;
  var getProvider;
  if (typeof window === 'undefined') {
    if (typeof self !== 'undefined' && self.qwenRetry) {
      ({ runWithRetry } = self.qwenRetry);
    } else {
      ({ runWithRetry } = require('./retry'));
    }
    if (typeof self !== 'undefined' && self.qwenProviders) {
      ({ getProvider } = self.qwenProviders);
    } else {
      ({ getProvider } = require('./providers'));
    }
  } else {
    if (root.qwenRetry) {
      ({ runWithRetry } = root.qwenRetry);
    } else if (typeof require !== 'undefined') {
      ({ runWithRetry } = require('./retry'));
    } else {
      runWithRetry = fn => fn();
    }
    if (root.qwenProviders) {
      ({ getProvider } = root.qwenProviders);
    } else if (typeof self !== 'undefined' && self.qwenProviders) {
      ({ getProvider } = self.qwenProviders);
    } else if (typeof require !== 'undefined') {
      ({ getProvider } = require('./providers'));
    }
  }
  async function translate(opts) {
    const { provider = 'qwen', text, debug, onRetry, retryDelay, onData } = opts;
    return runWithRetry(
      () => {
        const prov = getProvider ? getProvider(provider) : undefined;
        if (!prov || !prov.translate) throw new Error(`Unknown provider: ${provider}`);
        return prov.translate({ ...opts, onData });
      },
      text,
      { attempts: opts.attempts, debug, onRetry, retryDelay }
    );
  }
  const api = { translate };
  if (typeof module !== 'undefined') {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    root.qwenTransport = api;
  } else if (typeof self !== 'undefined') {
    root.qwenTransport = api;
  }
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis);
