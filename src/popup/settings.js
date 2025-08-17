(async function () {
  const defaults = {
    settingsTab: 'general',
    requestLimit: '',
    tokenLimit: '',
    enableDetection: true,
    glossary: '',
    cacheEnabled: false,
    localProviders: [],
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

  const providerList = document.getElementById('providerList');
  let providerConfig;
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

  const addBtn = document.getElementById('addLocalProvider');
  const wizard = document.getElementById('localProviderWizard');
  const typeSel = document.getElementById('localProviderType');
  const forms = {
    ollama: document.getElementById('ollamaForm'),
    macos: document.getElementById('macosForm'),
  };
  function updateLocalForm() {
    Object.entries(forms).forEach(([k, el]) => {
      if (el) el.style.display = k === typeSel.value ? 'block' : 'none';
    });
  }
  typeSel?.addEventListener('change', updateLocalForm);
  updateLocalForm();

  addBtn?.addEventListener('click', () => {
    wizard.hidden = !wizard.hidden;
  });

  document.getElementById('saveLocalProvider')?.addEventListener('click', () => {
    const type = typeSel.value;
    let config;
    if (type === 'ollama') {
      const path = document.getElementById('ollamaPath').value || 'http://localhost';
      const port = document.getElementById('ollamaPort').value || '11434';
      const model = document.getElementById('ollamaModel').value || '';
      config = { provider: 'ollama', endpoint: `${path}:${port}`, model };
    } else {
      const path = document.getElementById('macosPath').value || '';
      const port = document.getElementById('macosPort').value || '';
      const model = document.getElementById('macosModel').value || '';
      config = { provider: 'macos', path, port, model };
    }
    chrome?.storage?.sync?.get({ localProviders: [] }, s => {
      const list = Array.isArray(s.localProviders) ? s.localProviders : [];
      list.push(config);
      chrome?.storage?.sync?.set({ localProviders: list }, () => {
        wizard.hidden = true;
        refreshProviders();
      });
    });
  });

  const usageEl = document.getElementById('usageStats');
  chrome?.runtime?.sendMessage({ action: 'metrics' }, m => {
    const usage = m && m.usage ? m.usage : {};
    usageEl.textContent = JSON.stringify(usage, null, 2);
  });
})();

