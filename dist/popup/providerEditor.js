(function(){
  const overlay = document.getElementById('providerEditorOverlay');
  const apiKeyEl = overlay.querySelector('#pe_apiKey');
  const apiEndpointEl = overlay.querySelector('#pe_apiEndpoint');
  const modelInputEl = overlay.querySelector('#pe_modelInput');
  const modelSelectEl = overlay.querySelector('#pe_modelSelect');
  const reqLimitEl = overlay.querySelector('#pe_requestLimit');
  const tokLimitEl = overlay.querySelector('#pe_tokenLimit');
  const charLimitEl = overlay.querySelector('#pe_charLimit');
  const strategyEl = overlay.querySelector('#pe_strategy');
  const costPerInputTokenEl = overlay.querySelector('#pe_costPerInputToken');
  const costPerOutputTokenEl = overlay.querySelector('#pe_costPerOutputToken');
  const weightEl = overlay.querySelector('#pe_weight');
  const saveBtn = overlay.querySelector('#pe_save');
  const cancelBtn = overlay.querySelector('#pe_cancel');
  const advancedEl = overlay.querySelector('#pe_advanced');
  let currentId, cfg, refresh;

  function close(){
    overlay.style.display = 'none';
  }

  function validUrl(u){
    if(!u) return true;
    try{ new URL(u); return true;}catch{return false;}
  }

  async function open(id, config, onDone){
    currentId = id;
    cfg = config;
    refresh = onDone;
    const existing = (cfg.providers && cfg.providers[id]) || {};
    
    // Try to get secure API key via providerStore (unified storage), fall back to legacy
    let apiKey = existing.apiKey || '';
    try {
      if (window.qwenProviderStore?.getProviderSecret) {
        const s = await window.qwenProviderStore.getProviderSecret(id);
        if (s) apiKey = s;
      } else if (window.qwenSecureStorage?.secureStorage) {
        const secureKey = await window.qwenSecureStorage.secureStorage.getSecure(`provider:${id}`);
        if (secureKey) apiKey = secureKey;
      }
    } catch (error) {
      console.warn(`Failed to load API key for ${id}:`, error);
    }
    
    apiKeyEl.value = apiKey;
    apiEndpointEl.value = existing.apiEndpoint || '';
    modelInputEl.value = existing.model || '';
    modelSelectEl.innerHTML = '';
    modelSelectEl.style.display = 'none';
    modelInputEl.style.display = '';
    reqLimitEl.value = existing.requestLimit ?? cfg.requestLimit ?? '';
    tokLimitEl.value = existing.tokenLimit ?? cfg.tokenLimit ?? '';
    charLimitEl.value = existing.charLimit ?? cfg.charLimit ?? '';
    strategyEl.value = existing.strategy || cfg.strategy || 'balanced';
    const cpi = existing.costPerInputToken ?? cfg.costPerInputToken ?? existing.costPerToken ?? cfg.costPerToken;
    const cpo = existing.costPerOutputToken ?? cfg.costPerOutputToken ?? existing.costPerToken ?? cfg.costPerToken;
    costPerInputTokenEl.value = cpi != null ? cpi * 1e6 : '';
    costPerOutputTokenEl.value = cpo != null ? cpi * 1e6 : '';
    weightEl.value = existing.weight ?? cfg.weight ?? '';
    const prov = window.qwenProviders?.getProvider?.(id);
    if(prov?.listModels){
      try {
        const models = await prov.listModels();
        if (Array.isArray(models) && models.length) {
          models.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            modelSelectEl.appendChild(opt);
          });
          modelSelectEl.value = existing.model || cfg.model || models[0];
          modelSelectEl.style.display = '';
          modelInputEl.style.display = 'none';
        }
      } catch {}
    }
    window.qwenProviderConfig?.applyProviderConfig?.(prov, overlay);
    overlay.style.display = 'flex';
    resizePopup();
  }

  function resizePopup(){
    requestAnimationFrame(() => {
      const rect = overlay.firstElementChild.getBoundingClientRect();
      try { window.resizeTo(window.outerWidth, Math.ceil(rect.height + 20)); } catch {}
    });
  }

  advancedEl?.addEventListener('toggle', resizePopup);

  saveBtn.addEventListener('click', async () => {
    const apiEndpoint = apiEndpointEl.value.trim();
    if(!validUrl(apiEndpoint)){
      apiEndpointEl.classList.add('invalid');
      return;
    }
    apiEndpointEl.classList.remove('invalid');
    
    const apiKey = apiKeyEl.value.trim();
    const providers = cfg.providers || {};
    const num = v => (v === '' ? undefined : Number(v));
    const costInRaw = num(costPerInputTokenEl.value.trim());
    const costOutRaw = num(costPerOutputTokenEl.value.trim());
    
    // Store API key via providerStore if available, otherwise secure or legacy storage
    if (apiKey && window.qwenProviderStore?.setProviderSecret) {
      try {
        await window.qwenProviderStore.setProviderSecret(currentId, apiKey);
      } catch (error) {
        console.error(`providerStore.setProviderSecret failed for ${currentId}:`, error);
        if (window.qwenSecureStorage?.secureStorage) {
          await window.qwenSecureStorage.secureStorage.setSecure(`provider:${currentId}`, apiKey);
        }
      }
      // Remove API key from regular config to ensure it's not stored in plaintext
      providers[currentId] = {
        ...(providers[currentId] || {}),
        apiEndpoint,
        model: (modelSelectEl.style.display !== 'none' ? modelSelectEl.value : modelInputEl.value).trim(),
        requestLimit: num(reqLimitEl.value.trim()),
        tokenLimit: num(tokLimitEl.value.trim()),
        charLimit: num(charLimitEl.value.trim()),
        strategy: strategyEl.value,
        costPerInputToken: costInRaw == null ? undefined : costInRaw / 1e6,
        costPerOutputToken: costOutRaw == null ? undefined : costOutRaw / 1e6,
        weight: num(weightEl.value.trim()),
      };
      if (providers[currentId].apiKey) delete providers[currentId].apiKey;
    } else if (apiKey && window.qwenSecureStorage?.secureStorage) {
      try {
        await window.qwenSecureStorage.secureStorage.setSecure(`provider:${currentId}`, apiKey);
        // Remove API key from regular config to ensure it's not stored in plaintext
        providers[currentId] = {
          ...(providers[currentId] || {}),
          // Don't store apiKey in regular config when using secure storage
          apiEndpoint,
          model: (modelSelectEl.style.display !== 'none' ? modelSelectEl.value : modelInputEl.value).trim(),
          requestLimit: num(reqLimitEl.value.trim()),
          tokenLimit: num(tokLimitEl.value.trim()),
          charLimit: num(charLimitEl.value.trim()),
          strategy: strategyEl.value,
          costPerInputToken: costInRaw == null ? undefined : costInRaw / 1e6,
          costPerOutputToken: costOutRaw == null ? undefined : costOutRaw / 1e6,
          weight: num(weightEl.value.trim()),
        };
        
        // Also remove from legacy storage
        if (providers[currentId].apiKey) delete providers[currentId].apiKey;
      } catch (error) {
        console.error(`Failed to store secure API key for ${currentId}:`, error);
        // Fall back to legacy storage if secure storage fails
        providers[currentId] = {
          ...(providers[currentId] || {}),
          apiKey,
          apiEndpoint,
          model: (modelSelectEl.style.display !== 'none' ? modelSelectEl.value : modelInputEl.value).trim(),
          requestLimit: num(reqLimitEl.value.trim()),
          tokenLimit: num(tokLimitEl.value.trim()),
          charLimit: num(charLimitEl.value.trim()),
          strategy: strategyEl.value,
          costPerInputToken: costInRaw == null ? undefined : costInRaw / 1e6,
          costPerOutputToken: costOutRaw == null ? undefined : costOutRaw / 1e6,
          weight: num(weightEl.value.trim()),
        };
      }
    } else {
      // Legacy storage
      providers[currentId] = {
        ...(providers[currentId] || {}),
        apiKey,
        apiEndpoint,
        model: (modelSelectEl.style.display !== 'none' ? modelSelectEl.value : modelInputEl.value).trim(),
        requestLimit: num(reqLimitEl.value.trim()),
        tokenLimit: num(tokLimitEl.value.trim()),
        charLimit: num(charLimitEl.value.trim()),
        strategy: strategyEl.value,
        costPerInputToken: costInRaw == null ? undefined : costInRaw / 1e6,
        costPerOutputToken: costOutRaw == null ? undefined : costOutRaw / 1e6,
        weight: num(weightEl.value.trim()),
      };
    }
    
    cfg.providers = providers;
    if (!Array.isArray(cfg.providerOrder)) cfg.providerOrder = [];
    if (!cfg.providerOrder.includes(currentId)) cfg.providerOrder.push(currentId);
    window.qwenProviderConfig.saveProviderConfig(cfg);
    close();
    refresh?.();
  });

  cancelBtn.addEventListener('click', close);

  overlay.addEventListener('click', e => {
    if (e.target === overlay) close();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') close();
  });

  window.qwenProviderEditor = { open };
})();
