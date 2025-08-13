;(function (root) {
  if (root.qwenRetry) return;
  var runWithRateLimit;
  var approxTokens;
  if (typeof window === 'undefined') {
    if (typeof self !== 'undefined' && self.qwenThrottle) {
      ({ runWithRateLimit, approxTokens } = self.qwenThrottle);
    } else {
      ({ runWithRateLimit, approxTokens } = require('./throttle'));
    }
  } else {
    if (root.qwenThrottle) {
      ({ runWithRateLimit, approxTokens } = root.qwenThrottle);
    } else if (typeof require !== 'undefined') {
      ({ runWithRateLimit, approxTokens } = require('./throttle'));
    } else {
      runWithRateLimit = fn => fn();
      approxTokens = () => 0;
    }
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function runWithRetry(fn, text, opts = {}) {
    const tokens = typeof text === 'number' ? text : approxTokens(text || '');
    const { attempts = 6, debug = false, onRetry, retryDelay = 500 } = opts;
    let wait = retryDelay;
    for (let i = 0; i < attempts; i++) {
      try {
        if (debug) console.log('QTDEBUG: attempt', i + 1);
        return await runWithRateLimit(fn, tokens);
      } catch (err) {
        if (!err.retryable || i === attempts - 1) throw err;
        const delayMs = err.retryAfter || wait;
        if (onRetry) onRetry({ attempt: i + 1, delayMs, error: err });
        if (debug) console.log('QTDEBUG: retrying after error', err.message);
        await delay(delayMs);
        wait = delayMs * 2;
      }
    }
  }

  const api = { runWithRetry };
  if (typeof module !== 'undefined') {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    root.qwenRetry = api;
  } else if (typeof self !== 'undefined') {
    root.qwenRetry = api;
  }
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis);
