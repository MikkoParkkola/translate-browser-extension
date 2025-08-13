;(function (root) {
  if (root.qwenTransport) return;
  var runWithRetry;
  var approxTokens;
  var getProvider;
  if (typeof window === 'undefined') {
    if (typeof self !== 'undefined' && self.qwenThrottle) {
      ({ runWithRetry, approxTokens } = self.qwenThrottle);
    } else {
      ({ runWithRetry, approxTokens } = require('./throttle'));
    }
    if (typeof self !== 'undefined' && self.qwenProviders) {
      ({ getProvider } = self.qwenProviders);
    } else {
      ({ getProvider } = require('./providers'));
      require('./providers/qwen');
    }
  } else {
    if (window.qwenThrottle) {
      ({ runWithRetry, approxTokens } = window.qwenThrottle);
    } else if (typeof require !== 'undefined') {
      ({ runWithRetry, approxTokens } = require('./throttle'));
    } else {
      runWithRetry = fn => fn();
      approxTokens = () => 0;
    }
    if (window.qwenProviders) {
      ({ getProvider } = window.qwenProviders);
    } else if (typeof self !== 'undefined' && self.qwenProviders) {
      ({ getProvider } = self.qwenProviders);
    } else if (typeof require !== 'undefined') {
      ({ getProvider } = require('./providers'));
      require('./providers/qwen');
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
      approxTokens(text),
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
