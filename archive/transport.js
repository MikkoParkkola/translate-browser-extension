;(function (root) {
  if (root.qwenTransport) return;
  var runWithRetry;
  var getProvider;
  /* eslint-disable no-undef */
  if (typeof window === 'undefined') {
    if (typeof self !== 'undefined' && self.qwenRetry) {
      ({ runWithRetry } = self.qwenRetry);
    } else {
      ({ runWithRetry } = require('./retry'));
    }
    if (typeof self !== 'undefined' && self.qwenProviders) {
      ({ getProvider, initProviders } = self.qwenProviders);
      if (initProviders) initProviders();
    } else {
      ({ getProvider, initProviders } = require('./providers'));
      initProviders();
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
      ({ getProvider, initProviders } = root.qwenProviders);
      if (initProviders) initProviders();
    } else if (typeof self !== 'undefined' && self.qwenProviders) {
      ({ getProvider, initProviders } = self.qwenProviders);
      if (initProviders) initProviders();
    } else if (typeof require !== 'undefined') {
      ({ getProvider, initProviders } = require('./providers'));
      initProviders();
    }
  }
  /* eslint-enable no-undef */
  async function translateRequest(opts) {
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

  async function streamRequest(opts, onData) {
    return translateRequest({ ...opts, stream: true, onData });
  }

  const api = { translateRequest, streamRequest };
  if (typeof module !== 'undefined') {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    root.qwenTransport = api;
  } else if (typeof self !== 'undefined') {
    root.qwenTransport = api;
  }
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis);
