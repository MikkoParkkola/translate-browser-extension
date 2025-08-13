function applyProviderConfig(provider, doc = document) {
  const fields = (provider && provider.configFields) || ['apiKey', 'apiEndpoint', 'model'];
  const all = ['apiKey', 'apiEndpoint', 'model'];
  all.forEach(name => {
    const show = fields.includes(name);
    doc.querySelectorAll(`[data-field="${name}"]`).forEach(el => {
      el.style.display = show ? '' : 'none';
    });
  });
}

if (typeof window !== 'undefined') {
  window.qwenProviderConfig = { applyProviderConfig };
}
if (typeof module !== 'undefined') {
  module.exports = { applyProviderConfig };
}
