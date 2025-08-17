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
  function refreshProviders() {
    providerList.innerHTML = '';
    if (!window.qwenProviders?.listProviders) return;
    try { window.qwenProviders.ensureProviders?.(); } catch {}
    const list = window.qwenProviders.listProviders();
    list.forEach(({ name, label }) => {
      const li = document.createElement('li');
      li.textContent = `${label} (checking...)`;
      providerList.appendChild(li);
      let prov;
      try { prov = window.qwenProviders.getProvider(name); } catch {}
      if (!prov) { li.textContent = `${label} (unavailable)`; return; }
      if (typeof prov.capabilities === 'function') {
        prov.capabilities().then(meta => {
          li.textContent = `${label} (${meta.status || 'ok'})`;
        }).catch(err => {
          li.textContent = `${label} (error: ${err.message})`;
        });
      } else if (typeof prov.listModels === 'function') {
        prov.listModels().then(models => {
          li.textContent = `${label} (${models.length} models)`;
        }).catch(err => {
          li.textContent = `${label} (error: ${err.message})`;
        });
      } else {
        li.textContent = label;
      }
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

