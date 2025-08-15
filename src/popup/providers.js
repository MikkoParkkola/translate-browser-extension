(async function () {
  const list = document.getElementById('providerList');
  const tmpl = document.getElementById('providerTemplate');
  const failoverBox = document.getElementById('failover');
  const parallelBox = document.getElementById('parallel');
  const status = document.getElementById('status');
  const cfg = await window.qwenLoadConfig();
  const order = (cfg.providerOrder && cfg.providerOrder.length)
    ? cfg.providerOrder.slice()
    : Object.keys(cfg.providers || {});
  const providers = cfg.providers || {};
  const fields = ['apiKey','apiEndpoint','models','requestLimit','tokenLimit','charLimit','strategy'];

  function createItem(id) {
    const data = providers[id] || {};
    const li = tmpl.content.firstElementChild.cloneNode(true);
    li.dataset.id = id;
    li.querySelector('.provider-name').textContent = id;
    fields.forEach(f => {
      const input = li.querySelector(`[data-field="${f}"]`);
      if (!input) return;
      let v = data[f];
      if (Array.isArray(v)) v = v.join(', ');
      if (v != null) input.value = v;
    });
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
  parallelBox.checked = !!cfg.parallel;

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
    Array.from(list.children).forEach(li => {
      const id = li.dataset.id;
      const data = {};
      fields.forEach(f => {
        const input = li.querySelector(`[data-field="${f}"]`);
        if (!input) return;
        let v = input.value.trim();
        if (f === 'models') {
          let models = v.split(',').map(s => s.trim()).filter(Boolean);
          if (models.includes('qwen-mt-turbo') && !models.includes('qwen-mt-plus')) models.push('qwen-mt-plus');
          data.models = models;
        } else if (['requestLimit','tokenLimit','charLimit'].includes(f)) {
          data[f] = parseInt(v, 10) || 0;
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
    cfg.providerOrder = newOrder;
    cfg.providers = newProviders;
    cfg.failover = failoverBox.checked;
    cfg.parallel = parallelBox.checked;
    await window.qwenSaveConfig(cfg);
    status.textContent = 'Saved';
    setTimeout(() => (status.textContent = ''), 1000);
  });
})();
