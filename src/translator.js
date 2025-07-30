async function qwenTranslate({endpoint, apiKey, model, text, target}) {
  const url = `${endpoint}services/aigc/mt/text-translator/generation`;
  const body = {model, input: {source_language: 'auto', target_language: target, text}};
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({message: resp.statusText}));
    throw new Error(err.message || 'Translation failed');
  }
  const data = await resp.json();
  if (!data.output || !data.output.text) {
    throw new Error('Invalid API response');
  }
  return data.output;
}
if (typeof window !== 'undefined') {
  window.qwenTranslate = qwenTranslate;
}
if (typeof module !== 'undefined') {
  module.exports = { qwenTranslate };
}
