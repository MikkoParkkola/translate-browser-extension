(function (root, factory) {
  const mod = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.qwenLogger = mod;
}(typeof self !== 'undefined' ? self : this, function (root) {
  const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
  function parseLevel(l) {
    if (typeof l === 'number') return Math.max(0, Math.min(3, l|0));
    const s = String(l || '').toLowerCase();
    return LEVELS[s] ?? 1;
  }
  function redactValue(v) {
    if (typeof v === 'string') {
      return v
        .replace(/(api[-_\s]?key\s*[:=]\s*).*/ig, '$1<redacted>')
        .replace(/(authorization\s*[:=]\s*).*/ig, '$1<redacted>');
    }
    if (v instanceof Error) {
      const out = {};
      for (const k of Object.getOwnPropertyNames(v)) {
        if (/^authorization$/i.test(k) || /^api(?:[-_\s]?key)$/i.test(k)) {
          out[k] = '<redacted>';
        } else {
          out[k] = redactValue(v[k]);
        }
      }
      return out;
    }
    if (Array.isArray(v)) {
      return v.map(redactValue);
    }
    if (v && typeof v === 'object') {
      const out = Array.isArray(v) ? [] : {};
      for (const k of Object.keys(v)) {
        if (/^authorization$/i.test(k) || /^api(?:[-_\s]?key)$/i.test(k)) {
          out[k] = '<redacted>';
        } else {
          out[k] = redactValue(v[k]);
        }
      }
      return out;
    }
    return v;
  }
  function redact(args) {
    return args.map(redactValue);
  }
  const collectors = new Set();
  function addCollector(fn) {
    if (typeof fn === 'function') {
      collectors.add(fn);
      return () => collectors.delete(fn);
    }
    return () => {};
  }
  function emit(level, ns, redArgs) {
    const entry = { level, ns, args: redArgs };
    collectors.forEach(fn => { try { fn(entry); } catch {} });
  }
  function format(ns, red) {
    if (!red.length) return [`[${ns}]`];
    const [first, ...rest] = red;
    if (typeof first === 'string') return [`[${ns}] ${first}`, ...rest];
    return [`[${ns}]`, first, ...rest];
  }
  function globalLevel() {
    try {
      if (root.qwenConfig && root.qwenConfig.logLevel) return parseLevel(root.qwenConfig.logLevel);
    } catch {}
    try {
      if (typeof process !== 'undefined' && process.env && process.env.QWEN_LOG_LEVEL) {
        return parseLevel(process.env.QWEN_LOG_LEVEL);
      }
    } catch {}
    return 1; // default warn+
  }
  function create(ns) {
    const base = root.console || console;
    let lvl = globalLevel();
    return {
      setLevel(l) { lvl = parseLevel(l); },
      level() { return lvl; },
      create(child) { return create(ns ? `${ns}:${child}` : child); },
      debug(...a) { if (lvl >= 3) { const red = redact(a); base.debug(...format(ns, red)); emit('debug', ns, red); } },
      info(...a)  { if (lvl >= 2) { const red = redact(a); base.info(...format(ns, red)); emit('info', ns, red); } },
      warn(...a)  { if (lvl >= 1) { const red = redact(a); base.warn(...format(ns, red)); emit('warn', ns, red); } },
      error(...a) { const red = redact(a); base.error(...format(ns, red)); emit('error', ns, red); },
      async time(fn) {
        const start = Date.now();
        try {
          const result = await fn();
          const ms = Date.now() - start;
          const red = redact([{ latencyMs: ms }]);
          emit('debug', ns, red);
          return { result, ms };
        } catch (err) {
          const ms = Date.now() - start;
          const red = redact([{ latencyMs: ms, error: err && err.message }]);
          emit('debug', ns, red);
          if (err && typeof err === 'object') err.latencyMs = ms;
          throw err;
        }
      },
    };
  }
  return { create, parseLevel, addCollector };
}));
