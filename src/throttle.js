;(function (root) {
  if (root.qwenThrottle) return

  const queue = []
  let config = {
    requestLimit: 60,
    tokenLimit: 31980,
    windowMs: 60000,
  }
  // sliding window trackers for quota enforcement (all requests)
  const allRequestTimes = []
  const allTokenTimes = []
  // successful requests
  const requestTimes = []
  const tokenTimes = []
  // failed requests
  const failedRequestTimes = []
  const failedTokenTimes = []
  let totalRequests = 0
  let totalTokens = 0
  let failedTotalRequests = 0
  let failedTotalTokens = 0
  let processing = false
  let lastActivity = 0

function approxTokens(text) {
  return Math.max(1, Math.ceil(text.length / 4));
}

function throttleConfigure(opts = {}) {
  Object.assign(config, opts);
  lastActivity = 0;
}

function reset() {
  queue.length = 0;
  allRequestTimes.length = 0;
  allTokenTimes.length = 0;
  requestTimes.length = 0;
  tokenTimes.length = 0;
  failedRequestTimes.length = 0;
  failedTokenTimes.length = 0;
  totalRequests = 0;
  totalTokens = 0;
  failedTotalRequests = 0;
  failedTotalTokens = 0;
  processing = false;
  lastActivity = 0;
}

function recordAll(tokens) {
  const now = Date.now();
  allRequestTimes.push(now);
  allTokenTimes.push({ time: now, tokens });
  lastActivity = now;
  prune(now);
}

function recordSuccess(tokens) {
  const now = Date.now();
  requestTimes.push(now);
  tokenTimes.push({ time: now, tokens });
  totalRequests++;
  totalTokens += tokens;
  lastActivity = now;
  prune(now);
}

function recordFailure(tokens) {
  const now = Date.now();
  failedRequestTimes.push(now);
  failedTokenTimes.push({ time: now, tokens });
  failedTotalRequests++;
  failedTotalTokens += tokens;
  lastActivity = now;
  prune(now);
}

function prune(now = Date.now()) {
  const cutoff = now - config.windowMs;
  while (allRequestTimes.length && allRequestTimes[0] <= cutoff) allRequestTimes.shift();
  while (allTokenTimes.length && allTokenTimes[0].time <= cutoff) allTokenTimes.shift();
  while (requestTimes.length && requestTimes[0] <= cutoff) requestTimes.shift();
  while (tokenTimes.length && tokenTimes[0].time <= cutoff) tokenTimes.shift();
  while (failedRequestTimes.length && failedRequestTimes[0] <= cutoff) failedRequestTimes.shift();
  while (failedTokenTimes.length && failedTokenTimes[0].time <= cutoff) failedTokenTimes.shift();
}

function nextFreeTime(now = Date.now()) {
  const oldestReq = allRequestTimes[0] || 0;
  const oldestTok = allTokenTimes[0] ? allTokenTimes[0].time : 0;
  const t = Math.min(oldestReq, oldestTok);
  return t ? t + config.windowMs : now;
}

function processQueue() {
  if (processing) return;
  processing = true;
  const step = () => {
    prune();
    const now = Date.now();
    const usedReq = allRequestTimes.length;
    const usedTok = allTokenTimes.reduce((s, t) => s + t.tokens, 0);
    let availReq = config.requestLimit - usedReq;
    let availTok = config.tokenLimit - usedTok;
    while (queue.length && availReq > 0 && availTok >= queue[0].tokens) {
      const item = queue.shift();
      recordAll(item.tokens);
      availReq--;
      availTok -= item.tokens;
      Promise.resolve()
        .then(item.fn)
        .then(
          res => {
            recordSuccess(item.tokens);
            item.resolve(res);
          },
          err => {
            recordFailure(item.tokens);
            item.reject(err);
          }
        );
      setTimeout(step, Math.ceil(config.windowMs / config.requestLimit));
      return;
    }
    processing = false;
    if (queue.length) {
      const wait = Math.max(0, nextFreeTime() - Date.now());
      setTimeout(processQueue, wait);
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

function sumTokens(arr) {
  return arr.reduce((s, t) => s + t.tokens, 0);
}

function getUsage() {
  prune();
  return {
    requests: requestTimes.length,
    tokens: sumTokens(tokenTimes),
    failedRequests: failedRequestTimes.length,
    failedTokens: sumTokens(failedTokenTimes),
    requestLimit: config.requestLimit,
    tokenLimit: config.tokenLimit,
    totalRequests,
    totalTokens,
    failedTotalRequests,
    failedTotalTokens,
    queue: queue.length,
  };
}

  if (typeof module !== 'undefined') {
    module.exports = { runWithRateLimit, configure: throttleConfigure, approxTokens, getUsage, reset }
  }

  if (typeof window !== 'undefined') {
    root.qwenThrottle = {
      runWithRateLimit,
      configure: throttleConfigure,
      approxTokens,
      getUsage,
      reset,
    }
  } else if (typeof self !== 'undefined') {
    root.qwenThrottle = {
      runWithRateLimit,
      configure: throttleConfigure,
      approxTokens,
      getUsage,
      reset,
    }
  }
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis)
