(async function () {
  const list = document.getElementById('providerList');
  const failoverBox = document.getElementById('failover');
  const parallelBox = document.getElementById('parallel');
  const status = document.getElementById('status');
  const cfg = await window.qwenLoadConfig();
  const order = (cfg.providerOrder && cfg.providerOrder.length)
    ? cfg.providerOrder.slice()
    : Object.keys(cfg.providers || {});

  function createItem(id) {
    const li = document.createElement('li');
    li.textContent = id;
    li.draggable = true;
    li.dataset.id = id;
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
    cfg.providerOrder = newOrder;
    cfg.failover = failoverBox.checked;
    cfg.parallel = parallelBox.checked;
    await window.qwenSaveConfig(cfg);
    status.textContent = 'Saved';
    setTimeout(() => (status.textContent = ''), 1000);
  });
})();
