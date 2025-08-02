importScripts('throttle.js', 'translator.js');

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
  self.qwenThrottle.configure({
    requestLimit: cfg.requestLimit,
    tokenLimit: cfg.tokenLimit,
    windowMs: 60000,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const result = await self.qwenTranslate({
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'translate') {
    handleTranslate(msg.opts)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.action === 'ping') {
    if (msg.debug) console.log('QTDEBUG: ping received');
    sendResponse({ ok: true });
    return true;
  }
});
