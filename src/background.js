chrome.runtime.onInstalled.addListener(() => {
  console.log('Qwen Translator installed');
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'translate') {
    const { endpoint, apiKey, model, text, source, target } = msg.opts;
    const ep = endpoint.endsWith('/') ? endpoint : `${endpoint}/`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const url = `${ep}services/aigc/mt/text-translator/generation-stream`;
    console.log('Background translating via', url);
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: { source_language: source, target_language: target, text },
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
              if (obj.output && obj.output.text) result += obj.output.text;
            } catch {}
          }
        }
        sendResponse({ text: result });
      })
      .catch(err => {
        clearTimeout(timer);
        console.error('Background translation error:', err);
        sendResponse({ error: err.message });
      });
    return true;
  }
});
