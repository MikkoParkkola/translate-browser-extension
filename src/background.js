importScripts('throttle.js');
const { runWithRateLimit, approxTokens, configure } = self.qwenThrottle;

chrome.runtime.onInstalled.addListener(() => {
  console.log('Qwen Translator installed');
});

async function handleTranslate(opts) {
  const { endpoint, apiKey, model, text, source, target, debug } = opts;
  const ep = endpoint.endsWith('/') ? endpoint : `${endpoint}/`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  const url = `${ep}services/aigc/text-generation/generation`;
  if (debug) console.log('QTDEBUG: background translating via', url);

  const cfg = await new Promise(resolve =>
    chrome.storage.sync.get({ requestLimit: 60, tokenLimit: 100000 }, resolve)
  );
  configure({ requestLimit: cfg.requestLimit, tokenLimit: cfg.tokenLimit, windowMs: 60000 });

  try {
    const resp = await runWithRateLimit(() => fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey,
        'X-DashScope-SSE': 'enable',
      },
      body: JSON.stringify({
        model,
        input: { messages: [{ role: 'user', content: text }] },
        parameters: {
          translation_options: { source_lang: source, target_lang: target },
        },
      }),
      signal: controller.signal,
    }), approxTokens(text));

    clearTimeout(timer);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ message: resp.statusText }));
      if (debug) console.log('QTDEBUG: background HTTP error', err);
      return { error: `HTTP ${resp.status}: ${err.message}` };
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') { reader.cancel(); break; }
        try {
          const obj = JSON.parse(data);
          const chunk =
            obj.output?.text ||
            obj.output?.choices?.[0]?.message?.content || '';
          result += chunk;
        } catch {}
      }
    }
    if (debug) console.log('QTDEBUG: background translation completed');
    return { text: result };
  } catch (err) {
    clearTimeout(timer);
    console.error('QTERROR: background translation error', err);
    return { error: err.message };
  }
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action === 'translate') {
    return handleTranslate(msg.opts);
  }
});
