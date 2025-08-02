;(function (root) {
  if (root.qwenThrottle) return

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
  prune(now);
}

function prune(now = Date.now()) {
  while (requestTimes.length && now - requestTimes[0] > config.windowMs) requestTimes.shift();
  while (tokenTimes.length && now - tokenTimes[0].time > config.windowMs) tokenTimes.shift();
}

function processQueue() {
  while (queue.length && availableRequests > 0 && availableTokens >= queue[0].tokens) {
    const item = queue.shift();
    availableRequests--;
    availableTokens -= item.tokens;
    recordUsage(item.tokens);
    item.fn().then(item.resolve, item.reject);
  }
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

async function runWithRetry(fn, text, attempts = 3, debug = false) {
  const tokens = typeof text === 'number' ? text : approxTokens(text || '');
  let wait = 500;
  for (let i = 0; i < attempts; i++) {
    try {
      if (debug) console.log('QTDEBUG: attempt', i + 1);
      return await runWithRateLimit(fn, tokens);
    } catch (err) {
      if (!err.retryable || i === attempts - 1) throw err;
      if (debug) console.log('QTDEBUG: retrying after error', err.message);
      await delay(wait);
      wait *= 2;
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
