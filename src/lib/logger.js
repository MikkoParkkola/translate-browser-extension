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
  function redact(args) {
    return args.map(a => {
      if (typeof a !== 'string') return a;
      return a
        .replace(/(api[-_\s]?key)\s*[:=]\s*([A-Za-z0-9._-]+)/ig, '$1=<redacted>')
        .replace(/(authorization)\s*[:=]\s*([A-Za-z0-9._-]+)/ig, '$1=<redacted>');
    });
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
      debug(...a) { if (lvl >= 3) base.debug(`[${ns}]`, ...redact(a)); },
      info(...a)  { if (lvl >= 2) base.info(`[${ns}]`, ...redact(a)); },
      warn(...a)  { if (lvl >= 1) base.warn(`[${ns}]`, ...redact(a)); },
      error(...a) { base.error(`[${ns}]`, ...redact(a)); },
    };
  }
  return { create, parseLevel };
}));
