(async function () {
  const list = document.getElementById('providerList');
  const tmpl = document.getElementById('providerTemplate');
  const failoverBox = document.getElementById('failover');
  const parallelBox = document.getElementById('parallel');
  const status = document.getElementById('status');
  const recommendationEl = document.getElementById('recommendation');
  const cfg = await window.qwenLoadConfig();
  const benchmark = chrome?.storage?.sync
    ? (await new Promise(r => chrome.storage.sync.get({ benchmark: null }, r))).benchmark
    : null;
  if (benchmark?.recommendation && recommendationEl) {
    recommendationEl.textContent = `Recommended provider: ${benchmark.recommendation}`;
  }
  const order = (cfg.providerOrder && cfg.providerOrder.length)
    ? cfg.providerOrder.slice()
    : Object.keys(cfg.providers || {});
  const providers = cfg.providers || {};
  const baseFields = ['apiKey','apiEndpoint','model','models','strategy'];

  function labelFor(field) {
    if (field === 'charLimit') return 'Chars/month';
    if (field === 'requestLimit') return 'Req/min';
    if (field === 'tokenLimit') return 'Tok/min';
    if (field === 'costPerToken') return '$/tok';
    if (field === 'weight') return 'Weight';
    return field;
  }

  function validateNumber(input) {
    const v = input.value.trim();
    if (!v) {
      input.classList.remove('invalid');
      return true;
    }
    const n = Number(v);
    const ok = Number.isFinite(n) && n >= 0;
    input.classList.toggle('invalid', !ok);
    return ok;
  }

  function updateCostWarning(li) {
    const model = li.querySelector('[data-field="model"]')?.value.trim();
    const modelsInput = li.querySelector('[data-field="models"]');
    const warn = li.querySelector('.model-warning');
    if (!warn) return;
    const models = modelsInput?.value
      .split(',')
      .map(s => s.trim())
      .filter(Boolean) || [];
    const set = new Set(models);
    if (model) set.add(model);
    const hasPlus = set.has('qwen-mt-plus');
    const hasTurbo = set.has('qwen-mt-turbo');
    if (hasPlus && hasTurbo) {
      warn.textContent = 'Models have different costs';
      warn.style.display = '';
    } else {
      warn.textContent = '';
      warn.style.display = 'none';
    }
  }

  function createItem(id) {
    const data = providers[id] || {};
    const li = tmpl.content.firstElementChild.cloneNode(true);
    li.dataset.id = id;
    li.querySelector('.provider-name').textContent = id;

    const numericFields = Array.from(new Set([
      ...Object.keys(data).filter(k => /limit$/i.test(k)),
      'costPerToken',
      'weight',
    ]));
    const allFields = baseFields.concat(numericFields);

    allFields.forEach(f => {
      const input = li.querySelector(`[data-field="${f}"]`);
      if (!input) return;
      let v = data[f];
      if (Array.isArray(v)) v = v.join(', ');
      if (v != null) input.value = v;
    });

    const modelsInput = li.querySelector('[data-field="models"]');
    const plusLabel = document.createElement('label');
    const plusCheck = document.createElement('input');
    plusCheck.type = 'checkbox';
    plusLabel.appendChild(plusCheck);
    plusLabel.append(' Enable qwen-mt-plus fallback');
    modelsInput.parentElement.insertAdjacentElement('afterend', plusLabel);
    plusCheck.checked = Array.isArray(data.models) && data.models.includes('qwen-mt-plus');
    function syncPlusCheckbox() {
      const models = modelsInput.value.split(',').map(s => s.trim()).filter(Boolean);
      plusCheck.checked = models.includes('qwen-mt-plus');
      updateCostWarning(li);
    }
    modelsInput.addEventListener('input', syncPlusCheckbox);
    plusCheck.addEventListener('change', () => {
      let models = modelsInput.value.split(',').map(s => s.trim()).filter(Boolean);
      const hasPlus = models.includes('qwen-mt-plus');
      if (plusCheck.checked && !hasPlus) models.push('qwen-mt-plus');
      if (!plusCheck.checked && hasPlus) models = models.filter(m => m !== 'qwen-mt-plus');
      modelsInput.value = models.join(', ');
      updateCostWarning(li);
    });

    const extra = li.querySelector('.extra-limits');
    numericFields.forEach(f => {
      if (f === 'requestLimit' || f === 'tokenLimit') return;
      let input = li.querySelector(`[data-field="${f}"]`);
      if (!input && extra) {
        const label = document.createElement('label');
        label.textContent = labelFor(f);
        input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.dataset.field = f;
        label.appendChild(input);
        extra.appendChild(label);
      }
      if (input && data[f] != null) input.value = data[f];
    });

    ['requestLimit', 'tokenLimit'].forEach(f => {
      if (!numericFields.includes(f)) {
        const input = li.querySelector(`[data-field="${f}"]`);
        if (input) input.style.display = 'none';
      }
    });

    ['model'].forEach(f => {
      const input = li.querySelector(`[data-field="${f}"]`);
      if (input) input.addEventListener('input', () => updateCostWarning(li));
    });

    numericFields.forEach(f => {
      const input = li.querySelector(`[data-field="${f}"]`);
      if (input) input.addEventListener('input', () => validateNumber(input));
    });

    updateCostWarning(li);
    li.dataset.fields = allFields.join(',');
    li.dataset.numeric = numericFields.join(',');
    li.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', id);
      e.dataTransfer.effectAllowed = 'move';
    });
    li.addEventListener('dragover', e => e.preventDefault());
    li.addEventListener('drop', e => {
      e.preventDefault();
      const draggedId = e.dataTransfer.getData('text/plain');
      const dragEl = list.querySelector(`li[data-id="${draggedId}"]`);
      if (dragEl && dragEl !== li) {
        list.insertBefore(dragEl, li);
      }
    });
    return li;
  }

  order.forEach(id => list.appendChild(createItem(id)));
  failoverBox.checked = cfg.failover !== false;
  parallelBox.value = cfg.parallel === true ? 'on' : cfg.parallel === false ? 'off' : 'auto';

  list.addEventListener('dragover', e => e.preventDefault());
  list.addEventListener('drop', e => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain');
    const dragEl = list.querySelector(`li[data-id="${draggedId}"]`);
    if (dragEl) list.appendChild(dragEl);
  });

  document.getElementById('save').addEventListener('click', async () => {
    const newOrder = Array.from(list.children).map(li => li.dataset.id);
    const newProviders = {};
    let valid = true;
    Array.from(list.children).forEach(li => {
      const id = li.dataset.id;
      const data = {};
      const fields = (li.dataset.fields || '').split(',').filter(Boolean);
      const numeric = (li.dataset.numeric || '').split(',').filter(Boolean);
      fields.forEach(f => {
        const input = li.querySelector(`[data-field="${f}"]`);
        if (!input) return;
        let v = input.value.trim();
        if (f === 'models') {
          let models = v.split(',').map(s => s.trim()).filter(Boolean);
          data.models = models;
        } else if (numeric.includes(f)) {
          if (!validateNumber(input)) valid = false;
          if (v !== '') data[f] = parseInt(v, 10);
        } else {
          data[f] = v;
        }
      });
      if (data.models && !data.model) {
        data.model = (data.strategy === 'quality' && data.models.includes('qwen-mt-plus'))
          ? 'qwen-mt-plus'
          : data.models[0] || '';
      }
      if (data.models && data.models.length > 1) {
        data.secondaryModel = data.models.find(m => m !== data.model) || '';
      }
      newProviders[id] = data;
    });
    if (!valid) {
      status.textContent = 'Please fix invalid numbers';
      return;
    }
    cfg.providerOrder = newOrder;
    cfg.providers = newProviders;
    cfg.failover = failoverBox.checked;
    cfg.parallel = parallelBox.value === 'on' ? true : parallelBox.value === 'off' ? false : 'auto';
    await window.qwenSaveConfig(cfg);
    status.textContent = 'Saved';
    setTimeout(() => (status.textContent = ''), 1000);
  });
})();
