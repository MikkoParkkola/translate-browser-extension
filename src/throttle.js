;(function (root) {
  if (root.qwenThrottle) return

  function createThrottle(opts = {}) {
    const tLogger = (root.qwenLogger && root.qwenLogger.create) ? root.qwenLogger.create('throttle') : console;
    const queue = [];
    const config = Object.assign({
      requestLimit: 60,
      tokenLimit: 100000,
      windowMs: 60000,
    }, opts);
    let availableRequests = config.requestLimit;
    let availableTokens = config.tokenLimit;
    const requestTimes = [];
    const tokenTimes = [];
    let totalRequests = 0;
    let totalTokens = 0;
    let processing = false;
    let cooldown = false;
    let interval = setInterval(resetWindow, config.windowMs);

    function approxTokens(text) {
      return Math.max(1, Math.ceil(text.length / 4));
    }

    function configure(newOpts = {}) {
      Object.assign(config, newOpts);
      availableRequests = config.requestLimit;
      availableTokens = config.tokenLimit;
      if (interval) clearInterval(interval);
      interval = setInterval(resetWindow, config.windowMs);
    }

    function resetWindow() {
      availableRequests = config.requestLimit;
      availableTokens = config.tokenLimit;
      processQueue();
    }

    function recordUsage(tokens) {
      const now = Date.now();
      requestTimes.push(now);
      tokenTimes.push({ time: now, tokens });
      totalRequests++;
      totalTokens += tokens;
      prune(now);
    }

    function prune(now = Date.now()) {
      while (requestTimes.length && now - requestTimes[0] > config.windowMs) requestTimes.shift();
      while (tokenTimes.length && now - tokenTimes[0].time > config.windowMs) tokenTimes.shift();
    }

    function processQueue() {
      if (processing || cooldown) return;
      if (!queue.length) return;
      if (availableRequests <= 0 || availableTokens < queue[0].tokens) return;
      processing = true;
      const intervalMs = Math.ceil(config.windowMs / config.requestLimit);
      const item = queue.shift();
      availableRequests--;
      availableTokens -= item.tokens;
      recordUsage(item.tokens);
      item.fn().then(item.resolve, item.reject);
      processing = false;
      cooldown = true;
      setTimeout(() => { cooldown = false; processQueue(); }, intervalMs);
    }

    function runWithRateLimit(fn, text, opts = {}) {
      const tokens = typeof text === 'number' ? text : approxTokens(text || '');
      return new Promise((resolve, reject) => {
        if (opts.immediate && !cooldown && availableRequests > 0 && availableTokens >= tokens) {
          availableRequests--;
          availableTokens -= tokens;
          recordUsage(tokens);
          try {
            Promise.resolve(fn()).then(resolve, reject);
          } catch (e) {
            reject(e);
          }
          return;
        }
        queue.push({ fn, tokens, resolve, reject });
        processQueue();
      });
    }

    function delay(ms) {
      return new Promise(r => setTimeout(r, ms));
    }

    async function runWithRetry(fn, text, attempts = 6, debug = false) {
      const tokens = typeof text === 'number' ? text : approxTokens(text || '');
      let wait = 500;
      for (let i = 0; i < attempts; i++) {
        try {
          if (debug) tLogger.debug('attempt', i + 1);
          return await runWithRateLimit(fn, tokens, { immediate: true });
        } catch (err) {
          if (!err.retryable || i === attempts - 1) throw err;
          const base = err.retryAfter || wait;
          const jitter = 0.9 + Math.random() * 0.2;
          const delayMs = Math.round(base * jitter);
          if (debug) tLogger.debug('retrying after error', err.message, 'in', delayMs, 'ms');
          await delay(delayMs);
          wait = Math.min(base * 2, 60000);
        }
      }
    }

    function getUsage() {
      prune();
      const tokensUsed = tokenTimes.reduce((s, t) => s + t.tokens, 0);
      return {
        requests: requestTimes.length,
        tokens: tokensUsed,
        requestLimit: config.requestLimit,
        tokenLimit: config.tokenLimit,
        totalRequests,
        totalTokens,
        queue: queue.length,
      };
    }

    function reset() {
      queue.length = 0;
      requestTimes.length = 0;
      tokenTimes.length = 0;
      totalRequests = 0;
      totalTokens = 0;
      availableRequests = config.requestLimit;
      availableTokens = config.tokenLimit;
      processing = false;
      cooldown = false;
    }

    return { runWithRateLimit, runWithRetry, configure, approxTokens, getUsage, reset };
  }

  const globalThrottle = createThrottle();

  if (typeof module !== 'undefined') {
    module.exports = Object.assign({ createThrottle }, globalThrottle);
  }

  if (typeof window !== 'undefined') {
    root.qwenThrottle = Object.assign({ createThrottle }, globalThrottle);
  } else if (typeof self !== 'undefined') {
    root.qwenThrottle = Object.assign({ createThrottle }, globalThrottle);
  }
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis)
