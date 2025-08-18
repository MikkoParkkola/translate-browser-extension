(async function () {
  try { window.qwenProviders?.initProviders?.(); } catch {}
  const defaults = {
    settingsTab: 'general',
    enableDetection: true,
    glossary: '',
    cacheEnabled: false,
    localProviders: [],
    selectionPopup: false,
    sensitivity: 0.3,
  };

  function handleLastError(cb) {
    return (...args) => {
      const err = chrome.runtime.lastError;
      if (err && !err.message.includes('Receiving end does not exist')) console.debug(err);
      if (typeof cb === 'function') cb(...args);
    };
  }

  const store = await new Promise(res => {
    if (chrome?.storage?.sync) chrome.storage.sync.get({ ...defaults, theme: 'dark' }, res);
    else res({ ...defaults, theme: 'dark' });
  });

  document.documentElement.setAttribute('data-qwen-color', store.theme || 'dark');
  const themeSel = document.getElementById('theme');
  if (themeSel) {
    themeSel.value = store.theme || 'dark';
    themeSel.addEventListener('change', () => {
      const theme = themeSel.value;
      document.documentElement.setAttribute('data-qwen-color', theme);
      chrome?.storage?.sync?.set({ theme });
      chrome.runtime.sendMessage({ action: 'set-config', config: { theme } }, handleLastError());
      chrome.tabs?.query?.({ active: true, currentWindow: true }, tabs => {
        const t = tabs && tabs[0];
        if (t) chrome.tabs.sendMessage(t.id, { action: 'update-theme', theme }, handleLastError());
      });
    });
  }

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

  const sensitivityField = document.getElementById('sensitivity');
  if (sensitivityField) {
    sensitivityField.value = typeof store.sensitivity === 'number' ? store.sensitivity : 0;
    sensitivityField.addEventListener('input', () => {
      const val = Number(sensitivityField.value);
      chrome?.storage?.sync?.set({ sensitivity: val });
    });
  }

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
    chrome?.runtime?.sendMessage({ action: 'clear-cache' }, handleLastError());
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
    function isConfigured(name) {
      const meta = available.find(p => p.name === name);
      const fields = meta?.configFields || ['apiKey', 'apiEndpoint', 'model'];
      const cfg = providers[name] || {};
      for (const f of fields) {
        if ((f === 'apiKey' || f === 'apiEndpoint') && !cfg[f]) return false;
      }
      return true;
    }
    const order = Array.isArray(providerConfig.providerOrder)
      ? providerConfig.providerOrder.filter(n => providers[n] && isConfigured(n))
      : [];
    Object.keys(providers).forEach(n => {
      if (isConfigured(n) && !order.includes(n)) order.push(n);
    });
    let dragEl = null;
    function saveOrder() {
      providerConfig.providerOrder = Array.from(providerList.children).map(el => el.dataset.provider);
      window.qwenProviderConfig.saveProviderConfig(providerConfig);
    }
    function duplicateProvider(name) {
      const orig = providers[name];
      if (!orig) return;
      let newName = `${name}-copy`;
      let i = 1;
      while (providers[newName]) newName = `${name}-copy${i++}`;
      providers[newName] = { ...orig };
      const impl = window.qwenProviders?.getProvider?.(name);
      if (impl) window.qwenProviders?.registerProvider?.(newName, impl);
      if (!Array.isArray(providerConfig.providerOrder)) providerConfig.providerOrder = [];
      const idx = providerConfig.providerOrder.indexOf(name);
      if (idx >= 0) providerConfig.providerOrder.splice(idx + 1, 0, newName);
      else providerConfig.providerOrder.push(newName);
      window.qwenProviderConfig.saveProviderConfig(providerConfig);
      openEditor(newName);
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
      const dup = document.createElement('button');
      dup.textContent = 'Duplicate';
      dup.className = 'duplicate';
      dup.addEventListener('click', () => duplicateProvider(name));
      card.appendChild(dup);
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

  const templates = {
    openai: { id: 'openai', defaults: { apiEndpoint: 'https://api.openai.com/v1' }, fields: [{ name: 'apiEndpoint', label: 'API Endpoint', default: 'https://api.openai.com/v1' }] },
    deepl: { id: 'deepl', defaults: { apiEndpoint: 'https://api.deepl.com/v2' }, fields: [{ name: 'apiEndpoint', label: 'API Endpoint', default: 'https://api.deepl.com/v2' }] },
    ollama: { id: 'ollama', defaults: { apiEndpoint: 'http://localhost:11434', model: 'llama2' }, fields: [
      { name: 'apiEndpoint', label: 'API Endpoint', default: 'http://localhost:11434' },
      { name: 'model', label: 'Model', default: 'llama2' },
    ] },
    macos: { id: 'macos', defaults: {}, fields: [] },
    custom: { id: '', defaults: {}, fields: [{ name: 'id', label: 'Provider ID', default: '' }] },
  };

  const addOverlay = document.getElementById('addProviderOverlay');
  if (addOverlay) {
    const step1 = document.getElementById('ap_step1');
    const step2 = document.getElementById('ap_step2');
    const presetSelect = document.getElementById('ap_preset');
    const fieldsEl = document.getElementById('ap_fields');
    const nextBtn = document.getElementById('ap_next');
    const cancelBtn = document.getElementById('ap_cancel1');
    const backBtn = document.getElementById('ap_back');
    const createBtn = document.getElementById('ap_create');

    function showAddOverlay() {
      presetSelect.value = 'openai';
      step1.style.display = 'block';
      step2.style.display = 'none';
      addOverlay.style.display = 'flex';
    }

    nextBtn?.addEventListener('click', () => {
      const key = presetSelect.value;
      const tpl = templates[key];
      if (!tpl) return;
      fieldsEl.innerHTML = '';
      (tpl.fields || []).forEach(f => {
        const label = document.createElement('label');
        label.textContent = `${f.label || f.name} `;
        const input = document.createElement('input');
        input.id = `ap_field_${f.name}`;
        if (f.default) input.value = f.default;
        label.appendChild(input);
        fieldsEl.appendChild(label);
      });
      step1.style.display = 'none';
      step2.style.display = 'block';
    });

    backBtn?.addEventListener('click', () => {
      step2.style.display = 'none';
      step1.style.display = 'block';
    });

    cancelBtn?.addEventListener('click', () => {
      addOverlay.style.display = 'none';
    });

    createBtn?.addEventListener('click', () => {
      const key = presetSelect.value;
      const tpl = templates[key];
      if (!tpl) return;
      let id = tpl.id;
      const cfg = {};
      (tpl.fields || []).forEach(f => {
        const val = document.getElementById(`ap_field_${f.name}`)?.value.trim();
        if (f.name === 'id') id = val;
        else if (val) cfg[f.name] = val;
      });
      if (!id) return;
      providerConfig.providers[id] = { ...(tpl.defaults || {}), ...cfg };
      addOverlay.style.display = 'none';
      openEditor(id);
    });

    document.getElementById('addProvider')?.addEventListener('click', showAddOverlay);
  }

  const usageEl = document.getElementById('usageStats');
  chrome?.runtime?.sendMessage({ action: 'metrics' }, handleLastError(m => {
    const usage = m && m.usage ? m.usage : {};
    usageEl.textContent = JSON.stringify(usage, null, 2);
  }));
  const tmEl = document.getElementById('tmMetrics');
  const cacheEl = document.getElementById('cacheStats');
  chrome?.runtime?.sendMessage({ action: 'tm-cache-metrics' }, handleLastError(m => {
    const tmMetrics = m && m.tmMetrics ? m.tmMetrics : {};
    const cacheStats = m && m.cacheStats ? m.cacheStats : {};
    tmEl.textContent = JSON.stringify(tmMetrics, null, 2);
    cacheEl.textContent = JSON.stringify(cacheStats, null, 2);
  }));

  const tmEntriesEl = document.getElementById('tmEntries');
  const tmStatsEl = document.getElementById('tmStats');
  const tmImportFile = document.getElementById('tmImportFile');

  async function refreshTM() {
    if (!window.qwenTM) return;
    const entries = await window.qwenTM.getAll();
    tmEntriesEl.textContent = JSON.stringify(entries, null, 2);
    const stats = window.qwenTM.stats ? window.qwenTM.stats() : {};
    tmStatsEl.textContent = JSON.stringify(stats, null, 2);
  }

  document.getElementById('tmClear')?.addEventListener('click', async () => {
    try { await window.qwenTM.clear(); } catch {}
    refreshTM();
  });

  document.getElementById('tmExport')?.addEventListener('click', async () => {
    try {
      const entries = await window.qwenTM.getAll();
      const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'qwen-tm-backup.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {}
  });

  document.getElementById('tmImport')?.addEventListener('click', () => {
    tmImportFile?.click();
  });

  tmImportFile?.addEventListener('change', async () => {
    const file = tmImportFile.files && tmImportFile.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (Array.isArray(data)) {
        await window.qwenTM.clear();
        for (const item of data) {
          if (item && typeof item.k === 'string' && typeof item.text === 'string') {
            await window.qwenTM.set(item.k, item.text);
          }
        }
      }
    } catch {}
    tmImportFile.value = '';
    refreshTM();
  });

  refreshTM();
})();

