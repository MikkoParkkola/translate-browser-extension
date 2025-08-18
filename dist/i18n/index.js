(function() {
  const i18n = {
    messages: {},
    ready: null,
    async load() {
      if (this.ready) return this.ready;
      const lang = (navigator.language || 'en').split('-')[0];
      const url = chrome.runtime.getURL(`i18n/${lang}.json`);
      this.ready = fetch(url)
        .then(r => r.json())
        .catch(() => fetch(chrome.runtime.getURL('i18n/en.json')).then(r => r.json()))
        .then(msgs => { this.messages = msgs; });
      return this.ready;
    },
    t(key) {
      return this.messages[key] || key;
    },
    async apply() {
      await this.load();
      document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = this.t(el.getAttribute('data-i18n'));
      });
      document.querySelectorAll('[data-i18n-attr]').forEach(el => {
        const [attr, key] = el.getAttribute('data-i18n-attr').split(':');
        el.setAttribute(attr, this.t(key));
      });
    }
  };
  i18n.load();
  window.qwenI18n = i18n;
})();
