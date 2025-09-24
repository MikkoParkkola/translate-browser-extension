;(function(root){
  function chooseDefault({ endpoint, model, Providers }){
    try { if (Providers && typeof Providers.choose === 'function') return Providers.choose({ endpoint, model }); } catch {}
    const ep = String(endpoint || '').toLowerCase();
    if (ep.includes('openrouter')) return 'openrouter';
    if (ep.includes('openai')) return 'openai';
    if (ep.includes('anthropic') || ep.includes('claude')) return 'anthropic';
    if (ep.includes('mistral')) return 'mistral';
    if (ep.includes('deepl')) return 'deepl';
    if (ep.includes('google')) return 'google';
    if (ep.includes('ollama') || ep.includes('11434')) return 'ollama';
    if (ep.includes('gemini')) return 'gemini';
    if (ep.includes('macos')) return 'macos';
    if (ep.includes('dashscope') || ep.includes('qwen')) return 'dashscope';
    return 'dashscope';
  }

  function candidatesChain({ providerOrder, provider, endpoint, model, Providers }){
    try {
      if (Array.isArray(providerOrder) && providerOrder.length) {
        const order = providerOrder.slice();
        if (provider && order.includes(provider)) return order.slice(order.indexOf(provider));
        if (provider) return [provider, ...order.filter(p => p !== provider)];
        return order;
      }
      if (provider) return [provider];
      if (Providers && typeof Providers.candidates === 'function') return Providers.candidates({ endpoint, model });
      return [chooseDefault({ endpoint, model, Providers })];
    } catch {
      return [chooseDefault({ endpoint, model, Providers })];
    }
  }

  const api = { chooseDefault, candidatesChain };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') root.qwenProviderSelect = Object.assign(root.qwenProviderSelect||{}, api);
  else if (typeof self !== 'undefined') self.qwenProviderSelect = Object.assign(self.qwenProviderSelect||{}, api);
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this));

