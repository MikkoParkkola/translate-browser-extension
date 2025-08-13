(() => {
  var approxTokens;
  var getUsage;
  var cacheReady;
  var getCache;
  var setCache;
  var removeCache;
  var qwenTranslate;

  if (typeof window === 'undefined') {
    ({ approxTokens, getUsage } = require('./throttle'));
    ({ cacheReady, getCache, setCache, removeCache } = require('./cache'));
    require('./transport');
    ({ qwenTranslate } = require('./translator'));
  } else {
    if (window.qwenThrottle) {
      ({ approxTokens, getUsage } = window.qwenThrottle);
    } else if (typeof require !== 'undefined') {
      ({ approxTokens, getUsage } = require('./throttle'));
    } else {
      approxTokens = () => 0;
      getUsage = () => ({ requestLimit: 1, tokenLimit: 1, requests: 0, tokens: 0 });
    }
    if (window.qwenCache) {
      ({ cacheReady, getCache, setCache, removeCache } = window.qwenCache);
    } else if (typeof self !== 'undefined' && self.qwenCache) {
      ({ cacheReady, getCache, setCache, removeCache } = self.qwenCache);
    } else if (typeof require !== 'undefined') {
      ({ cacheReady, getCache, setCache, removeCache } = require('./cache'));
    }
    if (window.qwenTranslate) {
      qwenTranslate = window.qwenTranslate;
    } else if (typeof self !== 'undefined' && self.qwenTranslate) {
      qwenTranslate = self.qwenTranslate;
    } else if (typeof require !== 'undefined') {
      require('./transport');
      ({ qwenTranslate } = require('./translator'));
    }
  }

  let dynamicTokenBudget = 7000;
  let lastGoodBudget = 0;
  let budgetLocked = false;
  const MIN_TOKEN_BUDGET = 1000;
  const MAX_TOKEN_BUDGET = 16000;
  const GROWTH_FACTOR = 1.2;

  async function qwenTranslateBatch(params) {
    if (params.tokenBudget) return batchOnce(params);
    let tokenBudget = dynamicTokenBudget;
    try {
      const usage = getUsage ? getUsage() : {};
      const remainingReq = Math.max(1, (usage.requestLimit || 1) - (usage.requests || 0));
      const remainingTok = Math.max(1, (usage.tokenLimit || 1) - (usage.tokens || 0));
      const per = Math.floor(remainingTok / remainingReq);
      if (per > tokenBudget) tokenBudget = per;
    } catch {}
    while (true) {
      try {
        const res = await batchOnce({ ...params, tokenBudget, onRetry: params.onRetry, retryDelay: params.retryDelay });
        if (!budgetLocked) {
          lastGoodBudget = tokenBudget;
          if (tokenBudget < MAX_TOKEN_BUDGET) {
            tokenBudget = Math.min(
              MAX_TOKEN_BUDGET,
              Math.floor(tokenBudget * GROWTH_FACTOR)
            );
            dynamicTokenBudget = tokenBudget;
          }
        }
        return res;
      } catch (e) {
        if (/Parameter limit exceeded/i.test(e.message || '') && tokenBudget > MIN_TOKEN_BUDGET) {
          if (lastGoodBudget) {
            tokenBudget = lastGoodBudget;
            dynamicTokenBudget = tokenBudget;
            budgetLocked = true;
            if (typeof window !== 'undefined' && window.qwenLoadConfig && window.qwenSaveConfig) {
              try {
                const cfg = await window.qwenLoadConfig();
                if (!cfg.tokenBudget) {
                  cfg.tokenBudget = tokenBudget;
                  await window.qwenSaveConfig(cfg);
                }
              } catch {}
            }
            continue;
          }
          tokenBudget = Math.max(MIN_TOKEN_BUDGET, Math.floor(tokenBudget / 2));
          dynamicTokenBudget = tokenBudget;
          continue;
        }
        throw e;
      }
    }
  }

  function _getTokenBudget() {
    return dynamicTokenBudget;
  }

  function _setTokenBudget(v, lock = v > 0) {
    if (v > 0) {
      dynamicTokenBudget = v;
      lastGoodBudget = v;
    } else {
      dynamicTokenBudget = 7000;
      lastGoodBudget = 0;
    }
    budgetLocked = lock;
  }

  async function batchOnce({
    texts = [],
    tokenBudget = dynamicTokenBudget,
    maxBatchSize = 2000,
    retries = 1,
    onProgress,
    onRetry,
    retryDelay,
    _stats,
    ...opts
  }) {
    await cacheReady;
    const stats = _stats || { requests: 0, tokens: 0, words: 0, start: Date.now(), totalRequests: 0 };
    const SEP = '\uE000';

    const provider = opts.provider || 'qwen';
    const mapping = [];
    const seen = new Map();
    const dupes = new Map();
    texts.forEach((t, i) => {
      const key = `${provider}:${opts.source}:${opts.target}:${t}`;
      if (!opts.force) {
        const cached = getCache(key);
        if (cached) {
          mapping.push({ index: i, chunk: 0, text: cached.text, cached: true });
          seen.set(key, i);
          return;
        }
      }
      if (seen.has(key)) {
        const orig = seen.get(key);
        if (!dupes.has(orig)) dupes.set(orig, []);
        dupes.get(orig).push(i);
        return;
      }
      seen.set(key, i);
      const pieces = splitLongText(t, tokenBudget);
      pieces.forEach((p, idx) => mapping.push({ index: i, chunk: idx, text: p }));
    });
    const byIndex = new Map();
    mapping.forEach(m => {
      if (!byIndex.has(m.index)) byIndex.set(m.index, []);
      byIndex.get(m.index).push(m);
    });

    const groups = [];
    let group = [];
    let tokens = 0;
    for (const m of mapping.filter(m => !m.cached)) {
      const tk = approxTokens(m.text) + 1;
      if (group.length && (tokens + tk > tokenBudget || group.length >= maxBatchSize)) {
        groups.push(group);
        group = [];
        tokens = 0;
      }
      group.push(m);
      tokens += tk;
    }
    if (group.length) groups.push(group);
    stats.totalRequests += groups.length;

    for (const g of groups) {
      const joinedText = g.map(m => m.text.replaceAll(SEP, '')).join(SEP);
      const words = joinedText.replaceAll(SEP, ' ').trim().split(/\s+/).filter(Boolean).length;
      let res;
      try {
        res = await qwenTranslate({ ...opts, text: joinedText, onRetry, retryDelay, force: opts.force });
      } catch (e) {
        if (/HTTP\s+400/i.test(e.message || '')) throw e;
        g.forEach(m => {
          m.result = m.text;
        });
        continue;
      }
      const tk = approxTokens(joinedText);
      stats.tokens += tk;
      stats.words += words;
      stats.requests++;
      const translated = res && typeof res.text === 'string' ? res.text.split(SEP) : [];
      if (translated.length !== g.length) {
        if (tokenBudget > MIN_TOKEN_BUDGET) {
          dynamicTokenBudget = Math.max(MIN_TOKEN_BUDGET, Math.floor(tokenBudget / 2));
        }
        for (const m of g) {
          let out;
          try {
            const single = await qwenTranslate({ ...opts, text: m.text, onRetry, retryDelay, force: opts.force });
            out = single.text;
          } catch {
            out = m.text;
          }
          m.result = out;
          const key = `${provider}:${opts.source}:${opts.target}:${m.text}`;
          setCache(key, { text: out });
          stats.requests++;
          stats.tokens += approxTokens(m.text);
          stats.words += m.text.trim().split(/\s+/).filter(Boolean).length;
        }
        continue;
      }
      for (let i = 0; i < g.length; i++) {
        g[i].result = translated[i] || g[i].text;
        const key = `${provider}:${opts.source}:${opts.target}:${g[i].text}`;
        setCache(key, { text: g[i].result });
      }
      const elapsedMs = Date.now() - stats.start;
      const avg = elapsedMs / stats.requests;
      const etaMs = avg * (stats.totalRequests - stats.requests);
      if (onProgress)
        onProgress({ phase: 'translate', request: stats.requests, requests: stats.totalRequests, sample: g[0].text.slice(0, 80), elapsedMs, etaMs });
    }

    const results = new Array(texts.length).fill('');
    byIndex.forEach((arr, idx) => {
      const parts = arr
        .sort((a, b) => a.chunk - b.chunk)
        .map(m => (m.result !== undefined ? m.result : m.text));
      results[idx] = parts.join(' ').trim();
    });

    const retryTexts = [];
    const retryIdx = [];
    for (let i = 0; i < results.length; i++) {
      const orig = (texts[i] || '').trim();
      const out = (results[i] || '').trim();
      if (orig && out === orig && opts.source !== opts.target) {
        retryTexts.push(orig);
        retryIdx.push(i);
        const key = `${provider}:${opts.source}:${opts.target}:${orig}`;
        removeCache(key);
      }
    }
    if (retryTexts.length && retries > 0) {
      const retr = await qwenTranslateBatch({
        texts: retryTexts,
        tokenBudget,
        maxBatchSize,
        retries: retries - 1,
        onProgress,
        onRetry,
        retryDelay,
        _stats: stats,
        ...opts,
      });
      retryIdx.forEach((idx, i) => {
        results[idx] = retr.texts[i];
        const key = `${provider}:${opts.source}:${opts.target}:${texts[idx]}`;
        setCache(key, { text: results[idx] });
      });
    }

    dupes.forEach((arr, orig) => {
      arr.forEach(i => {
        results[i] = results[orig];
        const key = `${provider}:${opts.source}:${opts.target}:${texts[i]}`;
        setCache(key, { text: results[orig] });
      });
    });

    if (!_stats) {
      stats.elapsedMs = Date.now() - stats.start;
      stats.wordsPerSecond = stats.words / (stats.elapsedMs / 1000 || 1);
      stats.wordsPerRequest = stats.words / (stats.requests || 1);
      stats.tokensPerRequest = stats.tokens / (stats.requests || 1);
      if (onProgress)
        onProgress({ phase: 'translate', request: stats.requests, requests: stats.totalRequests, done: true, stats });
    }

    return { texts: results, stats };
  }

  function splitLongText(text, maxTokens) {
    const parts = (text || '').split(/(?<=[\.?!])\s+/);
    const chunks = [];
    let cur = '';
    for (const part of parts) {
      const next = cur ? cur + ' ' + part : part;
      if (approxTokens(next) > maxTokens && cur) {
        chunks.push(cur);
        cur = part;
      } else {
        cur = next;
      }
    }
    if (cur) chunks.push(cur);
    const out = [];
    for (const ch of chunks) {
      if (approxTokens(ch) <= maxTokens) {
        out.push(ch);
      } else {
        let start = 0;
        const step = Math.max(128, Math.floor(maxTokens * 4));
        while (start < ch.length) {
          out.push(ch.slice(start, start + step));
          start += step;
        }
      }
    }
    return out;
  }

  const api = { qwenTranslateBatch, _getTokenBudget, _setTokenBudget };
  if (typeof window !== 'undefined') {
    window.qwenTranslateBatch = qwenTranslateBatch;
    window.qwenSetTokenBudget = _setTokenBudget;
  }
  if (typeof self !== 'undefined' && typeof window === 'undefined') {
    self.qwenTranslateBatch = qwenTranslateBatch;
    self.qwenSetTokenBudget = _setTokenBudget;
  }
  if (typeof module !== 'undefined') {
    module.exports = api;
  }
  return api;
})();
