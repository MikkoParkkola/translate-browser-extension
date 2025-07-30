chrome.runtime.onInstalled.addListener(() => {
  console.log('Qwen Translator installed');
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'translate') {
    const { endpoint, apiKey, model, text, target } = msg.opts;
    const ep = endpoint.endsWith('/') ? endpoint : `${endpoint}/`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const url = `${ep}services/aigc/mt/text-translator/generation`;
    console.log('Background translating via', url);
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: { source_language: 'auto', target_language: target, text },
      }),
      signal: controller.signal,
    })
      .then(async resp => {
        clearTimeout(timer);
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ message: resp.statusText }));
          sendResponse({ error: `HTTP ${resp.status}: ${err.message}` });
          return;
        }
        const data = await resp.json();
        if (!data.output || !data.output.text) {
          sendResponse({ error: 'Invalid API response' });
          return;
        }
        sendResponse({ text: data.output.text, detected_language: data.output.detected_language });
      })
      .catch(err => {
        clearTimeout(timer);
        console.error('Background translation error:', err);
        sendResponse({ error: err.message });
      });
    return true;
  }
});
