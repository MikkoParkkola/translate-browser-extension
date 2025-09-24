(function (root, factory) {
  const mod = factory(root || {});
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root) root.qwenProviderStore = mod;
}(typeof self !== 'undefined' ? self : this, function (root) {
  const DEFAULT_CONFIG = {
    provider: 'qwen',
    providers: {},
    providerOrder: [],
    endpoints: {},
    failover: true,
    parallel: 'auto',
    model: '',
    secondaryModel: '',
  };

  const secureStorage = (typeof root !== 'undefined' && root.qwenSecureStorage) || null;

  let asyncChrome = null;
  try {
    if (root && root.qwenAsyncChrome) {
      asyncChrome = root.qwenAsyncChrome;
    } else {
      asyncChrome = require('./asyncChrome');
    }
  } catch (error) {
    asyncChrome = null;
  }

  const memoryStore = {
    config: JSON.parse(JSON.stringify(DEFAULT_CONFIG)),
  };

  const secureKeyPrefix = 'provider:';
  let cachedConfig = null;

  function clone(obj) {
    return obj ? JSON.parse(JSON.stringify(obj)) : obj;
  }

  function storageAvailable() {
    return typeof chrome !== 'undefined'
      && chrome.storage
      && chrome.storage.sync
      && typeof chrome.storage.sync.get === 'function';
  }

  async function storageGet(defaults) {
    if (storageAvailable()) {
      if (asyncChrome) {
        return asyncChrome.storage.sync.get(defaults || {});
      }
      return new Promise(resolve => {
        chrome.storage.sync.get(defaults || {}, resolve);
      });
    }
    return clone(memoryStore.config || defaults || {});
  }

  async function storageSet(values) {
    if (storageAvailable()) {
      if (asyncChrome) {
        await asyncChrome.storage.sync.set(values);
      } else {
        await new Promise(resolve => chrome.storage.sync.set(values, resolve));
      }
      return true;
    }
    memoryStore.config = Object.assign({}, memoryStore.config, clone(values));
    return true;
  }

  function normalizeProviderOrder(config) {
    config.providers = config.providers || {};
    const providerIds = Object.keys(config.providers);
    const order = Array.isArray(config.providerOrder) ? config.providerOrder.slice() : [];
    const seen = new Set();
    const normalized = [];
    order.forEach(id => {
      if (providerIds.includes(id) && !seen.has(id)) {
        normalized.push(id);
        seen.add(id);
      }
    });
    providerIds.forEach(id => {
      if (!seen.has(id)) {
        normalized.push(id);
        seen.add(id);
      }
    });
    config.providerOrder = normalized;
    if (!config.provider || !seen.has(config.provider)) {
      config.provider = normalized[0] || 'qwen';
    }
    return config;
  }

  function normalizeConfig(config) {
    const merged = Object.assign({}, DEFAULT_CONFIG, config || {});
    if (typeof merged.providers !== 'object' || merged.providers === null) {
      merged.providers = {};
    }
    const endpoints = typeof merged.endpoints === 'object' && merged.endpoints !== null ? { ...merged.endpoints } : {};
    Object.keys(merged.providers).forEach(id => {
      const entry = merged.providers[id] || {};
      merged.providers[id] = Object.assign({
        apiKey: '',
        apiEndpoint: '',
        model: '',
        secondaryModel: '',
      }, entry || {});
      const endpoint = merged.providers[id].apiEndpoint ? String(merged.providers[id].apiEndpoint) : '';
      if (endpoint) {
        endpoints[id] = endpoint;
      }
    });
    const primary = merged.providers[merged.provider] || {};
    if (primary.apiEndpoint) {
      endpoints[merged.provider] = String(primary.apiEndpoint);
    }
    Object.keys(endpoints).forEach(id => {
      if (!endpoints[id]) delete endpoints[id];
    });
    merged.endpoints = endpoints;
    return normalizeProviderOrder(merged);
  }

  function splitSecrets(config) {
    const sanitized = clone(config);
    const secrets = {};
    Object.entries(sanitized.providers || {}).forEach(([id, entry]) => {
      if (entry && entry.apiKey) {
        secrets[id] = entry.apiKey;
        delete entry.apiKey;
      }
    });
    return { sanitized, secrets };
  }

  function mergeSecrets(config, secrets) {
    if (!secrets) return config;
    const merged = clone(config);
    Object.entries(secrets).forEach(([id, apiKey]) => {
      if (!merged.providers[id]) merged.providers[id] = {};
      merged.providers[id].apiKey = apiKey;
    });
    return merged;
  }

  async function getSecret(providerId) {
    if (secureStorage && secureStorage.getSecure) {
      try {
        const value = await secureStorage.getSecure(`${secureKeyPrefix}${providerId}`);
        if (value) return value;
      } catch (error) {
        console.warn('[providerStore] getSecure failed', error);
      }
    }
    if (cachedConfig && cachedConfig.providers?.[providerId]?.apiKey) {
      return cachedConfig.providers[providerId].apiKey;
    }
    if (!storageAvailable()) {
      return memoryStore.config.providers?.[providerId]?.apiKey || '';
    }
    const stored = await storageGet(DEFAULT_CONFIG);
    return stored.providers?.[providerId]?.apiKey || '';
  }

  async function setSecret(providerId, apiKey) {
    if (secureStorage && secureStorage.setSecure) {
      try {
        await secureStorage.setSecure(`${secureKeyPrefix}${providerId}`, apiKey || '');
        return true;
      } catch (error) {
        console.warn('[providerStore] setSecure failed', error);
      }
    }
    const cfg = await storageGet(DEFAULT_CONFIG);
    cfg.providers = cfg.providers || {};
    if (!cfg.providers[providerId]) cfg.providers[providerId] = {};
    cfg.providers[providerId].apiKey = apiKey || '';
    await storageSet(cfg);
    return true;
  }

  async function attachSecrets(config) {
    const merged = clone(config);
    const providerIds = Object.keys(merged.providers || {});
    await Promise.all(providerIds.map(async id => {
      const secret = await getSecret(id);
      if (secret) {
        merged.providers[id].apiKey = secret;
      }
    }));
    return merged;
  }

  async function persistSecrets(secrets, config) {
    if (!secrets || Object.keys(secrets).length === 0) return;
    await Promise.all(Object.entries(secrets).map(([id, key]) => setSecret(id, key)));
    if (!secureStorage || !secureStorage.setSecure) {
      const fallback = clone(config);
      Object.entries(secrets).forEach(([id, key]) => {
        if (!fallback.providers[id]) fallback.providers[id] = {};
        fallback.providers[id].apiKey = key;
      });
      await storageSet(fallback);
    }
  }

  async function loadConfig(options = {}) {
    const opts = Object.assign({ includeSecrets: true, force: false }, options);
    if (!opts.force && cachedConfig && opts.includeSecrets) {
      return clone(cachedConfig);
    }
    const raw = await storageGet(DEFAULT_CONFIG);
    let normalized = normalizeConfig(raw);
    if (opts.includeSecrets) {
      normalized = await attachSecrets(normalized);
      cachedConfig = clone(normalized);
      return clone(normalized);
    }
    const stripped = splitSecrets(normalized).sanitized;
    if (!opts.force && !cachedConfig) {
      cachedConfig = await attachSecrets(normalized);
    }
    return stripped;
  }

  async function saveConfig(config) {
    const normalizedInput = normalizeConfig(config || {});
    const { sanitized, secrets } = splitSecrets(normalizedInput);
    await storageSet(sanitized);
    await persistSecrets(secrets, sanitized);
    cachedConfig = null;
    return loadConfig({ includeSecrets: true, force: true });
  }

  return {
    DEFAULT_CONFIG: clone(DEFAULT_CONFIG),
    async loadConfig(options) {
      return loadConfig(options);
    },
    async saveConfig(config) {
      return saveConfig(config);
    },
    async getProviderSecret(providerId) {
      return getSecret(providerId);
    },
    async setProviderSecret(providerId, apiKey) {
      return setSecret(providerId, apiKey);
    },
    invalidateCache() {
      cachedConfig = null;
    },
  };
}));
