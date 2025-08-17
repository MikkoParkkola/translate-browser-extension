(async function () {
  const defaults = {
    settingsTab: 'general',
    requestLimit: '',
    tokenLimit: '',
    enableDetection: true,
    glossary: '',
    cacheEnabled: false,
  };

  const store = await new Promise(res => {
    if (chrome?.storage?.sync) chrome.storage.sync.get(defaults, res);
    else res(defaults);
  });

  const theme = store.theme || (await new Promise(res => {
    if (chrome?.storage?.sync) chrome.storage.sync.get({ theme: 'dark' }, res);
    else res({ theme: 'dark' });
  })).theme;
  document.documentElement.setAttribute('data-qwen-color', theme || 'dark');

  const tabs = document.querySelectorAll('.tabs button');
  const sections = {
    general: document.getElementById('generalTab'),
    advanced: document.getElementById('advancedTab'),
    diagnostics: document.getElementById('diagnosticsTab'),
  };

  function activate(tab) {
    tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    Object.entries(sections).forEach(([k, el]) => {
      el.classList.toggle('active', k === tab);
    });
  }

  activate(store.settingsTab);
  tabs.forEach(btn => btn.addEventListener('click', () => {
    activate(btn.dataset.tab);
    chrome?.storage?.sync?.set({ settingsTab: btn.dataset.tab });
  }));

  const reqInput = document.getElementById('requestLimit');
  const tokInput = document.getElementById('tokenLimit');
  reqInput.value = store.requestLimit;
  tokInput.value = store.tokenLimit;

  function validateNumber(input) {
    const v = input.value.trim();
    if (!v) { input.classList.remove('invalid'); return true; }
    const n = Number(v);
    const ok = Number.isFinite(n) && n >= 0;
    input.classList.toggle('invalid', !ok);
    return ok;
  }

  [reqInput, tokInput].forEach(inp => inp.addEventListener('input', () => {
    if (validateNumber(inp)) {
      chrome?.storage?.sync?.set({ [inp.id]: inp.value.trim() });
    }
  }));

  const detectBox = document.getElementById('enableDetection');
  detectBox.checked = store.enableDetection;
  detectBox.addEventListener('change', () => {
    chrome?.storage?.sync?.set({ enableDetection: detectBox.checked });
  });

  const glossaryField = document.getElementById('glossary');
  glossaryField.value = store.glossary;
  glossaryField.addEventListener('input', () => {
    chrome?.storage?.sync?.set({ glossary: glossaryField.value });
  });

  const cacheBox = document.getElementById('cacheEnabled');
  cacheBox.checked = store.cacheEnabled;
  cacheBox.addEventListener('change', () => {
    chrome?.storage?.sync?.set({ cacheEnabled: cacheBox.checked });
  });
  document.getElementById('clearCache')?.addEventListener('click', () => {
    chrome?.runtime?.sendMessage({ action: 'clear-cache' });
  });

  const usageEl = document.getElementById('usageStats');
  chrome?.runtime?.sendMessage({ action: 'metrics' }, m => {
    const usage = m && m.usage ? m.usage : {};
    usageEl.textContent = JSON.stringify(usage, null, 2);
  });
})();

