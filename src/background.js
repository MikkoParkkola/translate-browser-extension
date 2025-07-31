importScripts('throttle.js');
const { runWithRetry, approxTokens, configure } = self.qwenThrottle;

chrome.runtime.onInstalled.addListener(() => {
  console.log('Qwen Translator installed');
});

async function handleTranslate(opts) {
  const { endpoint, apiKey, model, text, source, target, debug } = opts;
  const ep = endpoint.endsWith('/') ? endpoint : `${endpoint}/`;
  const url = `${ep}services/aigc/text-generation/generation`;
  if (debug) console.log('QTDEBUG: background translating via', url);

  const cfg = await new Promise(resolve =>
    chrome.storage.sync.get({ requestLimit: 60, tokenLimit: 100000 }, resolve)
  );
  configure({ requestLimit: cfg.requestLimit, tokenLimit: cfg.tokenLimit, windowMs: 60000 });

  try {
    const attempt = async () => {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 10000);
      try {
        const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: apiKey,
        },
        body: JSON.stringify({
          model,
          input: { messages: [{ role: 'user', content: text }] },
          parameters: { translation_options: { source_lang: source, target_lang: target } },
        }),
        signal: controller.signal,
      });
        if (!r.ok && r.status >= 500) {
          const err = new Error(`HTTP ${r.status}`);
          err.retryable = true;
          throw err;
        }
        return r;
      } catch (e) {
        e.retryable = true;
        throw e;
      } finally {
        clearTimeout(t);
      }
    };

    const resp = await runWithRetry(attempt, approxTokens(text), 3, debug);

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ message: resp.statusText }));
      if (debug) console.log('QTDEBUG: background HTTP error', err);
      return { error: `HTTP ${resp.status}: ${err.message}` };
    }

    const data = await resp.json();
    const text =
      data.output?.text ||
      data.output?.choices?.[0]?.message?.content || '';
    if (debug) console.log('QTDEBUG: background translation completed');
    return { text };
  } catch (err) {
    console.error('QTERROR: background translation error', err);
    return { error: err.message };
  }
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action === 'translate') {
    return handleTranslate(msg.opts);
  }
});
