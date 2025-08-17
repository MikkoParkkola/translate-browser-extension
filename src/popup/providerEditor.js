(function(){
  const overlay = document.getElementById('providerEditorOverlay');
  const apiKeyEl = overlay.querySelector('#pe_apiKey');
  const apiEndpointEl = overlay.querySelector('#pe_apiEndpoint');
  const modelEl = overlay.querySelector('#pe_model');
  const modelList = overlay.querySelector('#pe_modelList');
  const saveBtn = overlay.querySelector('#pe_save');
  const cancelBtn = overlay.querySelector('#pe_cancel');
  let currentId, cfg, refresh;

  function validUrl(u){
    if(!u) return true;
    try{ new URL(u); return true;}catch{return false;}
  }

  async function open(id, config, onDone){
    currentId = id;
    cfg = config;
    refresh = onDone;
    const existing = (cfg.providers && cfg.providers[id]) || {};
    apiKeyEl.value = existing.apiKey || '';
    apiEndpointEl.value = existing.apiEndpoint || '';
    modelEl.value = existing.model || '';
    modelList.innerHTML = '';
    const prov = window.qwenProviders?.getProvider?.(id);
    if(prov?.listModels){
      try {
        const models = await prov.listModels();
        models.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m;
          modelList.appendChild(opt);
        });
      } catch {}
    }
    window.qwenProviderConfig?.applyProviderConfig?.(prov, overlay);
    overlay.style.display = 'flex';
  }

  saveBtn.addEventListener('click', () => {
    const apiEndpoint = apiEndpointEl.value.trim();
    if(!validUrl(apiEndpoint)){
      apiEndpointEl.classList.add('invalid');
      return;
    }
    apiEndpointEl.classList.remove('invalid');
    const providers = cfg.providers || {};
    providers[currentId] = {
      ...(providers[currentId] || {}),
      apiKey: apiKeyEl.value.trim(),
      apiEndpoint,
      model: modelEl.value.trim()
    };
    window.qwenProviderConfig.saveProviderConfig({...cfg, providers});
    overlay.style.display = 'none';
    refresh?.();
  });

  cancelBtn.addEventListener('click', () => {
    overlay.style.display = 'none';
  });

  window.qwenProviderEditor = { open };
})();
