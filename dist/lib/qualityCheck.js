(function (root, factory) {
  const mod = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.qwenQualityCheck = mod;
}(typeof self !== 'undefined' ? self : this, function (root) {
  const logger = root.qwenLogger ? root.qwenLogger.create('quality') : console;
  function pickSample(text) {
    const s = String(text || '');
    if (!s) return '';
    const maxLen = Math.min(200, Math.max(20, Math.floor(s.length / 5)));
    if (s.length <= maxLen) return s;
    const start = Math.floor(Math.random() * (s.length - maxLen));
    return s.slice(start, start + maxLen);
  }
  function tokenize(str) {
    return String(str || '').trim().split(/\s+/).filter(Boolean);
  }
  function bleu(ref, cand) {
    const r = tokenize(ref);
    const c = tokenize(cand);
    const rlen = r.length;
    const clen = c.length;
    const maxN = 4;
    let logSum = 0;
    const smooth = 1e-9;
    for (let n = 1; n <= maxN; n++) {
      const refCounts = new Map();
      for (let i = 0; i <= rlen - n; i++) {
        const gram = r.slice(i, i + n).join(' ');
        refCounts.set(gram, (refCounts.get(gram) || 0) + 1);
      }
      let match = 0;
      const total = Math.max(0, clen - n + 1);
      for (let i = 0; i <= clen - n; i++) {
        const gram = c.slice(i, i + n).join(' ');
        const count = refCounts.get(gram) || 0;
        if (count > 0) {
          match++;
          refCounts.set(gram, count - 1);
        }
      }
      const p = total ? match / total : 0;
      logSum += Math.log(p || smooth);
    }
    const geo = Math.exp(logSum / maxN);
    const bp = clen > rlen ? 1 : Math.exp(1 - rlen / Math.max(clen, 1));
    return Math.round(bp * geo * 100) / 100;
  }
  async function verify({ text, source, target, provider, endpoint, model, apiKey, providerOrder, endpoints }) {
    if (!root.qwenTranslate || !root.qwenProviders) return { score: 0 };
    const sample = pickSample(text);
    const candidates = root.qwenProviders.candidates({ provider, endpoint });
    const secondary = candidates.find(p => p !== provider);
    if (!secondary) return { score: 0 };
    const epBase = (endpoints && endpoints[secondary]) || endpoint;
    const ep2 = epBase && /\/$/.test(epBase) ? epBase : (epBase ? epBase + '/' : epBase);
    const [primary, second] = await Promise.all([
      root.qwenTranslate({ endpoint, apiKey, model, text: sample, source, target, provider, stream: false, noProxy: true, providerOrder, endpoints }),
      root.qwenTranslate({ endpoint: ep2, apiKey, model, text: sample, source, target, provider: secondary, stream: false, noProxy: true, providerOrder, endpoints }),
    ]);
    const score = bleu(primary && primary.text, second && second.text);
    if (score < 0.8) {
      try { logger.warn('quality mismatch', { score, sample, primary: primary && primary.text, secondary: second && second.text, provider, secondary }); } catch {}
    }
    return { score, sample, primary: primary && primary.text, secondary: second && second.text };
  }
  return { verify };
}));
