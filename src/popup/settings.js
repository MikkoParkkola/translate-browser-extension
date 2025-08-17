(async function () {
  const defaults = {
    settingsTab: 'general',
    enableDetection: true,
    glossary: '',
    cacheEnabled: false,
    localProviders: [],
    selectionPopup: false,
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
    providers: document.getElementById('providersTab'),
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

  const detectBox = document.getElementById('enableDetection');
  detectBox.checked = store.enableDetection;
  detectBox.addEventListener('change', () => {
    chrome?.storage?.sync?.set({ enableDetection: detectBox.checked });
  });

  const selectionBox = document.getElementById('selectionPopup');
  if (selectionBox) {
    selectionBox.checked = store.selectionPopup;
    selectionBox.addEventListener('change', () => {
      chrome?.storage?.sync?.set({ selectionPopup: selectionBox.checked });
    });
  }

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

  const providerList = document.getElementById('providerList');
  let providerConfig;
  let editorLoaded = false;
  async function openEditor(id) {
    let overlay = document.getElementById('providerEditorOverlay');
    if (!overlay) {
      const html = await fetch('providerEditor.html').then(r => r.text());
      const div = document.createElement('div');
      div.innerHTML = html;
      overlay = div.firstElementChild;
      document.body.appendChild(overlay);
    }
    if (!editorLoaded) {
      await new Promise(res => {
        const s = document.createElement('script');
        s.src = 'providerEditor.js';
        s.onload = () => { editorLoaded = true; res(); };
        document.body.appendChild(s);
      });
    }
    window.qwenProviderEditor.open(id, providerConfig, refreshProviders);
  }

  async function refreshProviders() {
    providerList.innerHTML = '';
    if (!window.qwenProviderConfig?.loadProviderConfig) return;
    providerConfig = await window.qwenProviderConfig.loadProviderConfig();
    try { window.qwenProviders?.ensureProviders?.(); } catch {}
    const available = window.qwenProviders?.listProviders?.() || [];
    const providers = providerConfig.providers || {};
    providerConfig.providers = providers;
    const order = Array.isArray(providerConfig.providerOrder)
      ? providerConfig.providerOrder.slice()
      : [];
    available.forEach(p => { if (!order.includes(p.name)) order.push(p.name); });
    let dragEl = null;
    function saveOrder() {
      providerConfig.providerOrder = Array.from(providerList.children).map(el => el.dataset.provider);
      window.qwenProviderConfig.saveProviderConfig(providerConfig);
    }
    order.forEach(name => {
      const meta = available.find(p => p.name === name) || { name, label: name };
      if (!providers[name]) providers[name] = {};
      const card = document.createElement('div');
      card.className = 'provider-card';
      card.draggable = true;
      card.dataset.provider = name;
      const handle = document.createElement('span');
      handle.className = 'drag-handle';
      handle.textContent = '☰';
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = providers[name].enabled !== false;
      checkbox.addEventListener('change', () => {
        providers[name].enabled = checkbox.checked;
        window.qwenProviderConfig.saveProviderConfig(providerConfig);
      });
      label.appendChild(checkbox);
      label.append(` ${meta.label}`);
      card.appendChild(handle);
      card.appendChild(label);
      const edit = document.createElement('button');
      edit.textContent = 'Edit';
      edit.addEventListener('click', () => openEditor(name));
      card.appendChild(edit);
      card.addEventListener('dragstart', e => {
        dragEl = card;
        e.dataTransfer?.setData('text/plain', name);
      });
      card.addEventListener('dragover', e => {
        e.preventDefault();
        const target = e.target.closest('.provider-card');
        if (dragEl && target && dragEl !== target) {
          const rect = target.getBoundingClientRect();
          const after = (e.clientY - rect.top) / rect.height > 0.5;
          providerList.insertBefore(dragEl, after ? target.nextSibling : target);
        }
      });
      card.addEventListener('dragend', () => {
        dragEl = null;
        saveOrder();
      });
      providerList.appendChild(card);
    });
  }
  refreshProviders();

  document.getElementById('addProvider')?.addEventListener('click', () => {
    const preset = prompt('Preset? (openai, deepl, ollama, macos, custom)');
    if (!preset) return;
    const key = preset.toLowerCase();
    const templates = {
      openai: { id: 'openai', defaults: { apiEndpoint: 'https://api.openai.com/v1' } },
      deepl: { id: 'deepl', defaults: { apiEndpoint: 'https://api.deepl.com/v2' } },
      ollama: { id: 'ollama', defaults: { apiEndpoint: 'http://localhost:11434', model: 'llama2' } },
      macos: { id: 'macos', defaults: {} },
      custom: {},
    };
    let tpl = templates[key];
    if (!tpl) return;
    if (key === 'custom') {
      const customId = prompt('Provider ID?');
      if (!customId) return;
      tpl = { id: customId, defaults: {} };
    }
    providerConfig.providers[tpl.id] = { ...(tpl.defaults || {}) };
    openEditor(tpl.id);
  });

  const usageEl = document.getElementById('usageStats');
  chrome?.runtime?.sendMessage({ action: 'metrics' }, m => {
    const usage = m && m.usage ? m.usage : {};
    usageEl.textContent = JSON.stringify(usage, null, 2);
  });
})();

