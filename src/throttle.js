;(function (root) {
  if (root.qwenThrottle) return

  const tLogger = (root.qwenLogger && root.qwenLogger.create) ? root.qwenLogger.create('throttle') : console;

  const queue = []
  let config = {
    requestLimit: 60,
    tokenLimit: 100000,
    windowMs: 60000,
  }
  let availableRequests = config.requestLimit
  let availableTokens = config.tokenLimit
  const requestTimes = []
  const tokenTimes = []
  let totalRequests = 0
  let totalTokens = 0
  let processing = false
  let interval = setInterval(() => {
    availableRequests = config.requestLimit
    availableTokens = config.tokenLimit
    processQueue()
  }, config.windowMs)

function approxTokens(text) {
  return Math.max(1, Math.ceil(text.length / 4));
}

function throttleConfigure(opts = {}) {
  Object.assign(config, opts);
  availableRequests = config.requestLimit;
  availableTokens = config.tokenLimit;
  if (interval) clearInterval(interval);
  interval = setInterval(() => {
    availableRequests = config.requestLimit;
    availableTokens = config.tokenLimit;
    processQueue();
  }, config.windowMs);
}

function recordUsage(tokens) {
  const now = Date.now();
  requestTimes.push(now);
  tokenTimes.push({ time: now, tokens });
  totalRequests++
  totalTokens += tokens
  prune(now);
}

function prune(now = Date.now()) {
  while (requestTimes.length && now - requestTimes[0] > config.windowMs) requestTimes.shift();
  while (tokenTimes.length && now - tokenTimes[0].time > config.windowMs) tokenTimes.shift();
}

function processQueue() {
  if (processing) return;
  processing = true;
  const step = () => {
    while (queue.length && availableRequests > 0 && availableTokens >= queue[0].tokens) {
      const item = queue.shift();
      availableRequests--;
      availableTokens -= item.tokens;
      recordUsage(item.tokens);
      item.fn().then(item.resolve, item.reject);
      const usage = getUsage();
      const ratio = Math.max(
        usage.requests / config.requestLimit,
        usage.tokens / config.tokenLimit
      );
      if (ratio > 0.5) {
        setTimeout(step, Math.ceil(config.windowMs / config.requestLimit));
        return;
      }
    }
    processing = false;
    if (queue.length && availableRequests > 0 && availableTokens >= queue[0].tokens) {
      processing = true;
      setTimeout(step, 0);
    }
  };
  step();
}

function runWithRateLimit(fn, text) {
  const tokens = typeof text === 'number' ? text : approxTokens(text || '');
  return new Promise((resolve, reject) => {
    queue.push({ fn, tokens, resolve, reject });
    processQueue();
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runWithRetry(fn, text, attempts = 6, debug = false) {
  const tokens = typeof text === 'number' ? text : approxTokens(text || '');
  let wait = 500;
  for (let i = 0; i < attempts; i++) {
    try {
      if (debug) tLogger.debug('attempt', i + 1);
      return await runWithRateLimit(fn, tokens);
    } catch (err) {
      if (!err.retryable || i === attempts - 1) throw err;
      const base = err.retryAfter || wait;
      const jitter = 0.9 + Math.random() * 0.2; // +/-10%
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

  if (typeof module !== 'undefined') {
    module.exports = { runWithRateLimit, runWithRetry, configure: throttleConfigure, approxTokens, getUsage }
  }

  if (typeof window !== 'undefined') {
    root.qwenThrottle = {
      runWithRateLimit,
      runWithRetry,
      configure: throttleConfigure,
      approxTokens,
      getUsage,
    }
  } else if (typeof self !== 'undefined') {
    root.qwenThrottle = {
      runWithRateLimit,
      runWithRetry,
      configure: throttleConfigure,
      approxTokens,
      getUsage,
    }
  }
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis)
