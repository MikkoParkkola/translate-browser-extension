importScripts('throttle.js', 'translator.js');
const { configure } = self.qwenThrottle;
const { qwenTranslate } = self;

chrome.runtime.onInstalled.addListener(() => {
  console.log('Qwen Translator installed');
});

async function handleTranslate(opts) {
  const { endpoint, apiKey, model, text, source, target, debug } = opts;
  const ep = endpoint.endsWith('/') ? endpoint : `${endpoint}/`;
  if (debug) console.log('QTDEBUG: background translating via', ep);

  const cfg = await new Promise(resolve =>
    chrome.storage.sync.get({ requestLimit: 60, tokenLimit: 100000 }, resolve)
  );
  configure({ requestLimit: cfg.requestLimit, tokenLimit: cfg.tokenLimit, windowMs: 60000 });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const result = await qwenTranslate({
      endpoint: ep,
      apiKey,
      model,
      text,
      source,
      target,
      debug,
      signal: controller.signal,
      stream: false,
    });
    if (debug) console.log('QTDEBUG: background translation completed');
    return result;
  } catch (err) {
    console.error('QTERROR: background translation error', err);
    return { error: err.message };
  } finally {
    clearTimeout(timeout);
  }
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action === 'translate') {
    return handleTranslate(msg.opts);
  }
});
