// src/options.js

(async function () {
  try { window.qwenProviders?.initProviders?.(); } catch {}
  
  const defaults = {
    localProviders: [],
  };

  function handleLastError(cb) {
    return (...args) => {
      const err = chrome.runtime.lastError;
      if (err && !err.message.includes('Receiving end does not exist')) console.debug(err);
      if (typeof cb === 'function') cb(...args);
    };
  }

  // Load settings
  const store = await new Promise(res => {
    if (chrome?.storage?.sync) chrome.storage.sync.get(defaults, res);
    else res(defaults);
  });

  // Initialize provider settings
  const providerList = document.getElementById('providerList');
  const addProvider = document.getElementById('addProvider');
  
  // ... (provider management logic from the original options.js would go here) ...

})();