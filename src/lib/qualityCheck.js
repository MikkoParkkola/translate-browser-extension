(function (root, factory) {
  const mod = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.qwenQualityCheck = mod;
}(typeof self !== 'undefined' ? self : this, function (root) {
  const logger = root && root.qwenLogger ? root.qwenLogger.create('quality') : console;

  function pickSample(text) {
    const s = String(text || '');
    if (!s) return '';
    const maxLen = Math.min(200, Math.max(20, Math.floor(s.length / 5)));
    if (s.length <= maxLen) return s;
    const start = Math.floor(Math.random() * Math.max(1, s.length - maxLen));
    return s.slice(start, start + maxLen);
  }

  function tokenize(str) {
    return String(str || '').trim().split(/\s+/).filter(Boolean);
  }

  function bleu(reference, candidate) {
    const refTokens = tokenize(reference);
    const candTokens = tokenize(candidate);
    if (!refTokens.length || !candTokens.length) return 0;
    const maxN = 4;
    let logSum = 0;
    const smooth = 1e-9;

    for (let n = 1; n <= maxN; n++) {
      const refCounts = new Map();
      for (let i = 0; i <= refTokens.length - n; i++) {
        const gram = refTokens.slice(i, i + n).join(' ');
        refCounts.set(gram, (refCounts.get(gram) || 0) + 1);
      }

      let match = 0;
      const total = Math.max(0, candTokens.length - n + 1);
      for (let i = 0; i <= candTokens.length - n; i++) {
        const gram = candTokens.slice(i, i + n).join(' ');
        const count = refCounts.get(gram) || 0;
        if (count > 0) {
          match++;
          refCounts.set(gram, count - 1);
        }
      }

      const precision = total ? match / total : 0;
      logSum += Math.log(precision || smooth);
    }

    const geoMean = Math.exp(logSum / maxN);
    const brevity = candTokens.length > refTokens.length
      ? 1
      : Math.exp(1 - refTokens.length / Math.max(candTokens.length, 1));

    return Math.round(brevity * geoMean * 100) / 100;
  }

  async function verify({ text, source, target, provider, endpoint, model, apiKey, providerOrder, endpoints }) {
    if (!root || !root.qwenTranslate || !root.qwenProviders) {
      return { score: 0 };
    }

    const sample = pickSample(text);
    if (!sample) return { score: 0 };

    const candidates = root.qwenProviders.candidates({ provider, endpoint });
    const secondary = candidates.find(id => id !== provider);
    if (!secondary) return { score: 0 };

    const primaryEndpoint = endpoint;
    const secondaryBase = (endpoints && endpoints[secondary]) || endpoint;
    const secondaryEndpoint = secondaryBase && /\/$/.test(secondaryBase) ? secondaryBase : `${secondaryBase || ''}`.replace(/\/*$/, '/') ;

    const [primary, alt] = await Promise.allSettled([
      root.qwenTranslate({ endpoint: primaryEndpoint, apiKey, model, text: sample, source, target, provider, stream: false, noProxy: true, providerOrder, endpoints }),
      root.qwenTranslate({ endpoint: secondaryEndpoint, apiKey, model, text: sample, source, target, provider: secondary, stream: false, noProxy: true, providerOrder, endpoints }),
    ]);

    const primaryText = primary.status === 'fulfilled' && primary.value ? primary.value.text : '';
    const secondaryText = alt.status === 'fulfilled' && alt.value ? alt.value.text : '';
    const score = bleu(primaryText, secondaryText);

    if (score < 0.8) {
      try {
        logger.warn('quality mismatch', { score, sample, primary: primaryText, secondary: secondaryText, provider, secondary });
      } catch (_) {}
    }

    return { score, sample, primary: primaryText, secondary: secondaryText };
  }

  return { verify };
}));
