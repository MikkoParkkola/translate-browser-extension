const queue = [];
let config = {
  requestLimit: 60,
  tokenLimit: 100000,
  windowMs: 60000,
};
let availableRequests = config.requestLimit;
let availableTokens = config.tokenLimit;
let interval = setInterval(() => {
  availableRequests = config.requestLimit;
  availableTokens = config.tokenLimit;
  processQueue();
}, config.windowMs);

function approxTokens(text) {
  return Math.max(1, Math.ceil(text.length / 4));
}

function configure(opts = {}) {
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

function processQueue() {
  while (queue.length && availableRequests > 0 && availableTokens >= queue[0].tokens) {
    const item = queue.shift();
    availableRequests--;
    availableTokens -= item.tokens;
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

if (typeof module !== 'undefined') {
  module.exports = { runWithRateLimit, configure, approxTokens };
}

if (typeof window !== 'undefined') {
  window.qwenThrottle = { runWithRateLimit, configure, approxTokens };
} else if (typeof self !== 'undefined') {
  self.qwenThrottle = { runWithRateLimit, configure, approxTokens };
}
