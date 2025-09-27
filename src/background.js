(() => {
  const files = [
    'core/error-handler.js',
    'core/provider-loader.js',
    'core/cache-manager.js',
    'core/security.js',
    'core/secure-storage.js',
    'core/command-dispatcher.js',
    'core/command-registry.js',
    'commands/translation-command.js',
    'commands/system-commands.js',
    'commands/config-commands.js',
    'commands/translation-memory-commands.js',
    'commands/metrics-commands.js',
    'commands/provider-commands.js',
    'commands/testing-commands.js',
    'lib/logger.js',
    'lib/providers.js',
    'lib/tm.js',
    'lib/feedback.js',
    'lib/qualityCheck.js',
    'lib/offline.js',
    'lib/messaging.js',
    'config.js',
    'throttle.js',
    'translator.js',
    'usageColor.js',
    'findLimit.js',
    'limitDetector.js',
    'background/storage.js',
    'background/messaging.js',
    'background/stateUtils.js',
    'background/commandRouter.js',
    'backgroundBenchmark.js',
  ];

  const candidateUrls = (file) => {
    const urls = [];
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function') {
        urls.push(chrome.runtime.getURL(file));
      }
    } catch (error) {
      // ignore runtime lookup errors; we'll fall back to the raw path
    }
    urls.push(file);
    return Array.from(new Set(urls.filter(Boolean)));
  };

  if (typeof importScripts === 'function') {
    for (const file of files) {
      let loaded = false;
      let lastError = null;
      const urls = candidateUrls(file);
      for (const url of urls) {
        try {
          importScripts(url);
          if (typeof console !== 'undefined' && console.debug) {
            console.debug('[background] imported', file, 'via', url);
          }
          loaded = true;
          break;
        } catch (error) {
          lastError = error;
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('[background] import attempt failed', { file, url, error });
          }
        }
      }
      if (!loaded) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('[background] failed to import module after retries', { file, urls, error: lastError });
        }
        throw (lastError || new Error('Failed to import "' + file + '"'));
      }
    }
  } else if (typeof require === 'function') {
    files.forEach(f => {
      try {
        require('./' + f);
      } catch (error) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[background] require fallback failed', f, error?.message || error);
        }
      }
    });
  }
})();

// Ensure helper is available when importScripts is stubbed (tests)
if (typeof self.isOfflineError === 'undefined' && typeof require === 'function') {
  self.isOfflineError = require('./lib/offline.js').isOfflineError;
}

const logger = (self.qwenLogger && self.qwenLogger.create)
  ? self.qwenLogger.create('background')
  : console;

let providerStore;
try {
  if (self.qwenProviderStore) {
    providerStore = self.qwenProviderStore;
  } else {
    providerStore = require('./lib/providerStore');
  }
} catch (error) {
  providerStore = null;
}

let asyncChrome;
try {
  if (self.qwenAsyncChrome) {
    asyncChrome = self.qwenAsyncChrome;
  } else {
    asyncChrome = require('./lib/asyncChrome');
  }
} catch (error) {
  asyncChrome = null;
}

let stateUtils;
try {
  if (self.qwenStateUtils) {
    stateUtils = self.qwenStateUtils;
  } else {
    stateUtils = require('./background/stateUtils');
  }
} catch (error) {
  stateUtils = null;
}

let storageHelpers;
try {
  if (self.qwenBackgroundStorage && self.qwenBackgroundStorage.createStorage) {
    storageHelpers = self.qwenBackgroundStorage.createStorage(asyncChrome);
  } else {
    storageHelpers = require('./background/storage').createStorage(asyncChrome);
  }
} catch (error) {
  storageHelpers = {
    get: (area, defaults) => Promise.resolve({ ...(defaults || {}) }),
    set: () => Promise.resolve(),
    remove: () => Promise.resolve(),
    merge: async (_area, defaults, updates) => ({ ...(defaults || {}), ...(updates || {}) }),
};
}

const storageGet = storageHelpers.get;
const storageSet = storageHelpers.set;
const storageRemove = storageHelpers.remove;

let messagingHelpers;
try {
  if (self.qwenBackgroundMessaging) {
    messagingHelpers = self.qwenBackgroundMessaging;
  } else {
    messagingHelpers = require('./background/messaging');
  }
} catch (error) {
  messagingHelpers = {
    withLastError: cb => cb,
    sendMessage: () => Promise.resolve(null),
    sendMessageSync: () => {},
  };
}

const withLastError = messagingHelpers.withLastError;
const sendRuntimeMessage = messagingHelpers.sendMessage;
const sendTabMessage = messagingHelpers.sendToTab;
const queryTabs = messagingHelpers.queryTabs;

// Initialize error handler
const errorHandler = self.qwenErrorHandler || {
  handle: (error, _context = {}, fallback) => {
    logger.error('Error handler not available:', error);
    return fallback || null;
  },
  handleAsync: async (promise, _context = {}, fallback) => {
    try {
      return await promise;
    } catch (error) {
      logger.error('Error handler not available for async operation:', error);
      return fallback || null;
    }
  },
  safe: (fn, _context = {}, fallback) => {
    return (...args) => {
      try {
        return fn.apply(this, args);
      } catch (error) {
        logger.error('Error handler not available for safe wrapper:', error);
        return fallback || null;
      }
    };
  },
  isNetworkError: (error) => {
    const message = error?.message || '';
    return message.toLowerCase().includes('network') || message.toLowerCase().includes('fetch');
  },
};


const TRANSLATE_TIMEOUT_MS = (self.qwenDefaultConfig && self.qwenDefaultConfig.translateTimeoutMs) || 20000;

const DEFAULT_ENDPOINT = (self.qwenDefaultConfig && self.qwenDefaultConfig.apiEndpoint) || 'https://dashscope-intl.aliyuncs.com/api/v1';
const DEFAULT_MODEL = (self.qwenDefaultConfig && self.qwenDefaultConfig.model) || '';
const LOCAL_PROVIDER_ID = 'hunyuan-local';
const GOOGLE_FREE_PROVIDER_ID = 'google-free';

const PROVIDER_CONFIG_DEFAULTS = (() => {
  const base = providerStore && providerStore.DEFAULT_CONFIG
    ? { ...providerStore.DEFAULT_CONFIG }
    : {};
  return {
    provider: base.provider || GOOGLE_FREE_PROVIDER_ID,
    providers: {
      ...base.providers,
      [GOOGLE_FREE_PROVIDER_ID]: {
        enabled: true,
        ...(base.providers && base.providers[GOOGLE_FREE_PROVIDER_ID]),
      },
      [LOCAL_PROVIDER_ID]: {
        enabled: false,
        ...(base.providers && base.providers[LOCAL_PROVIDER_ID]),
      },
    },
    providerOrder: base.providerOrder && base.providerOrder.length
      ? base.providerOrder
      : [GOOGLE_FREE_PROVIDER_ID],
    failover: typeof base.failover === 'boolean' ? base.failover : true,
    parallel: base.parallel || 'auto',
    model: base.model || DEFAULT_MODEL,
    secondaryModel: base.secondaryModel || '',
    apiEndpoint: base.apiEndpoint || DEFAULT_ENDPOINT,
  };
})();

function normalizeProviderSnapshot(raw) {
  const snapshot = Object.assign({}, PROVIDER_CONFIG_DEFAULTS, raw || {});
  if (!snapshot.provider) snapshot.provider = 'qwen';
  if (!snapshot.providers || typeof snapshot.providers !== 'object') snapshot.providers = {};
  snapshot.providers = Object.keys(snapshot.providers).reduce((acc, id) => {
    acc[id] = { ...(snapshot.providers[id] || {}) };
    return acc;
  }, {});
  if (!snapshot.providers[snapshot.provider]) {
    snapshot.providers[snapshot.provider] = {};
  }
  if (!snapshot.providers[LOCAL_PROVIDER_ID]) {
    snapshot.providers[LOCAL_PROVIDER_ID] = {};
  }
  if (snapshot.providers[LOCAL_PROVIDER_ID].enabled === undefined) {
    snapshot.providers[LOCAL_PROVIDER_ID].enabled = false;
  }
  if (!snapshot.providers[GOOGLE_FREE_PROVIDER_ID]) {
    snapshot.providers[GOOGLE_FREE_PROVIDER_ID] = { enabled: true };
  } else if (snapshot.providers[GOOGLE_FREE_PROVIDER_ID].enabled === undefined) {
    snapshot.providers[GOOGLE_FREE_PROVIDER_ID].enabled = true;
  }
  if (!Array.isArray(snapshot.providerOrder)) snapshot.providerOrder = [];
  snapshot.apiEndpoint = snapshot.apiEndpoint || DEFAULT_ENDPOINT;
  const primary = snapshot.providers[snapshot.provider] || {};
  if (!snapshot.model) snapshot.model = primary.model || DEFAULT_MODEL;
  if (!snapshot.secondaryModel) snapshot.secondaryModel = primary.secondaryModel || '';
  if (!snapshot.apiKey && primary.apiKey) snapshot.apiKey = primary.apiKey;
  if (typeof snapshot.failover !== 'boolean') snapshot.failover = true;
  if (snapshot.parallel !== 'auto' && snapshot.parallel !== true && snapshot.parallel !== false) {
    snapshot.parallel = 'auto';
  }

  let enabledProviders = Object.entries(snapshot.providers).filter(([, info = {}]) => info.enabled !== false);
  if (!enabledProviders.length) {
    const fallbackId = snapshot.provider === LOCAL_PROVIDER_ID ? GOOGLE_FREE_PROVIDER_ID : snapshot.provider || GOOGLE_FREE_PROVIDER_ID;
    const fallbackInfo = { ...(snapshot.providers[fallbackId] || {}), enabled: true };
    snapshot.providers[fallbackId] = fallbackInfo;
    snapshot.provider = fallbackId;
    enabledProviders = [[fallbackId, fallbackInfo]];
  }
  const hasLocalEnabled = enabledProviders.some(([id]) => id === LOCAL_PROVIDER_ID);
  const hasRemoteEnabled = enabledProviders.some(([id]) => id !== LOCAL_PROVIDER_ID);
  const primaryInfo = snapshot.providers[snapshot.provider];
  if (!primaryInfo || primaryInfo.enabled === false) {
    const firstRemote = enabledProviders.find(([id]) => id !== LOCAL_PROVIDER_ID);
    const fallbackId = firstRemote ? firstRemote[0] : enabledProviders[0][0];
    snapshot.provider = fallbackId;
    if (!snapshot.providers[fallbackId]) snapshot.providers[fallbackId] = {};
    snapshot.providers[fallbackId].enabled = true;
  }
  if (!hasRemoteEnabled && hasLocalEnabled && !snapshot.providerOrder.includes(LOCAL_PROVIDER_ID)) {
    snapshot.providerOrder.unshift(LOCAL_PROVIDER_ID);
  }
  if (isEnabled(GOOGLE_FREE_PROVIDER_ID)) {
    snapshot.providerOrder = snapshot.providerOrder.filter(id => id !== GOOGLE_FREE_PROVIDER_ID);
    snapshot.providerOrder.unshift(GOOGLE_FREE_PROVIDER_ID);
    if (!hasRemoteEnabled) {
      snapshot.provider = snapshot.provider || GOOGLE_FREE_PROVIDER_ID;
    }
  }
  return snapshot;
}

async function applyBenchmarkRecommendation(snapshot) {
  if (!chrome?.storage?.sync) return;
  try {
    const { benchmark = null } = await storageGet('sync', { benchmark: null });
    if (!benchmark) return;

    const isEnabled = (id) => {
      const info = snapshot.providers[id];
      return !!info && info.enabled !== false;
    };

    const promote = (id) => {
      if (!id || !isEnabled(id)) return;
      snapshot.providerOrder = (snapshot.providerOrder || []).filter(p => p !== id);
      snapshot.providerOrder.unshift(id);
      if (snapshot.provider !== id && id === benchmark.recommendation) {
        snapshot.provider = id;
      }
    };

    if (benchmark.recommendation) {
      promote(benchmark.recommendation);
    }

    const localResult = benchmark.results?.[LOCAL_PROVIDER_ID];
    if (localResult && !localResult.error) {
      const remoteResults = Object.entries(benchmark.results || {})
        .filter(([id, data]) => id !== LOCAL_PROVIDER_ID && data && !data.error);
      const localBeatsAll = remoteResults.length
        ? remoteResults.every(([, data]) => {
            if (!data) return true;
            const localCost = Number(localResult.costPerToken) || 0;
            const remoteCost = Number(data.costPerToken) || Number.MAX_VALUE;
            const localLatency = Number(localResult.latency) || Number.MAX_VALUE;
            const remoteLatency = Number(data.latency) || Number.MAX_VALUE;
            return localCost <= remoteCost && localLatency <= remoteLatency;
          })
        : true;
      if (localBeatsAll) {
        promote(LOCAL_PROVIDER_ID);
      }
    }
  } catch (error) {
    logger.debug?.('benchmark recommendation skipped', error);
  }
}

function buildProviderOrder(snapshot, requested, overrideOrder) {
  const requestedId = requested || snapshot.provider || 'qwen';
  const enabled = new Set();
  Object.entries(snapshot.providers || {}).forEach(([id, info]) => {
    if (!info || info.enabled === false) return;
    enabled.add(id);
  });
  if (!enabled.size) {
    const fallbackId = requestedId === LOCAL_PROVIDER_ID ? 'qwen' : requestedId || 'qwen';
    enabled.add(fallbackId);
    if (!snapshot.providers[fallbackId]) snapshot.providers[fallbackId] = { enabled: true };
    else snapshot.providers[fallbackId].enabled = true;
    if (!snapshot.provider) snapshot.provider = fallbackId;
  }

  const baseOrder = Array.isArray(overrideOrder) && overrideOrder.length
    ? overrideOrder
    : Array.isArray(snapshot.providerOrder) ? snapshot.providerOrder : [];

  const localEnabled = !!(snapshot.providers[LOCAL_PROVIDER_ID] && snapshot.providers[LOCAL_PROVIDER_ID].enabled !== false);

  const isEnabled = (id) => {
    if (!id) return false;
    if (id === LOCAL_PROVIDER_ID) return localEnabled;
    const info = snapshot.providers[id];
    return !!info && info.enabled !== false;
  };

  const order = [];
  const push = (id, { force = false } = {}) => {
    if (!id) return;
    if (!force && !isEnabled(id)) return;
    if (!order.includes(id)) order.push(id);
  };

  if (isEnabled(GOOGLE_FREE_PROVIDER_ID)) {
    push(GOOGLE_FREE_PROVIDER_ID, { force: true });
  }
  baseOrder.forEach(id => push(id));
  push(requestedId, { force: (requestedId === LOCAL_PROVIDER_ID && localEnabled) || requestedId === GOOGLE_FREE_PROVIDER_ID });
  enabled.forEach(id => push(id));

  if (!order.length) order.push(requestedId);

  if (requestedId === LOCAL_PROVIDER_ID) {
    const idx = order.indexOf(LOCAL_PROVIDER_ID);
    if (idx > 0) {
      order.splice(idx, 1);
      order.unshift(LOCAL_PROVIDER_ID);
    }
  }

  return order;
}

async function loadProviderConfigWithSecrets({ force = false } = {}) {
  if (providerStore && providerStore.loadConfig) {
    try {
      return await providerStore.loadConfig({ includeSecrets: true, force });
    } catch (error) {
      logger.warn('providerStore.loadConfig failed', error);
    }
  }
  const legacyDefaults = {
    provider: 'qwen',
    providers: {},
    providerOrder: [],
    apiKey: '',
    apiEndpoint: DEFAULT_ENDPOINT,
    model: DEFAULT_MODEL,
    secondaryModel: '',
    failover: true,
    parallel: 'auto',
    translateTimeoutMs: TRANSLATE_TIMEOUT_MS,
    requestThreshold: config.requestThreshold,
    qualityVerify: config.qualityVerify,
  };
  return storageGet('sync', legacyDefaults);
}

async function resolveProviderSettings(opts = {}) {
  const fallbackProviderOrder = Array.isArray(config.providerOrder) ? config.providerOrder.slice() : [];
  const defaultConfig = (typeof self !== 'undefined' && self.qwenDefaultConfig) || {};
  const localDefaults = (defaultConfig.providers && defaultConfig.providers[LOCAL_PROVIDER_ID]) || {};
  const fallbackProviders = { ...(config.providers || {}) };
  const ensureProviderEntry = (id) => {
    if (!id) return;
    const existing = fallbackProviders[id] || {};
    if (id === LOCAL_PROVIDER_ID) {
      fallbackProviders[id] = { ...localDefaults, ...existing };
    } else if (!fallbackProviders[id]) {
      fallbackProviders[id] = existing;
    }
  };
  ensureProviderEntry(opts.provider);
  fallbackProviderOrder.forEach(ensureProviderEntry);
  if (Array.isArray(opts.providerOrder)) opts.providerOrder.forEach(ensureProviderEntry);

  const fallback = {
    provider: config.provider || opts.provider || 'qwen',
    providers: fallbackProviders,
    providerOrder: fallbackProviderOrder,
    failover: typeof config.failover === 'boolean' ? config.failover : true,
    parallel: config.parallel,
    apiEndpoint: config.apiEndpoint,
    model: config.model,
    secondaryModel: config.secondaryModel,
  };

  const snapshotRaw = await loadProviderConfigWithSecrets();
  const mergedRaw = snapshotRaw
    ? {
        provider: snapshotRaw.provider ?? fallback.provider,
        providerOrder: snapshotRaw.providerOrder && snapshotRaw.providerOrder.length
          ? snapshotRaw.providerOrder
          : fallback.providerOrder,
        providers: { ...fallback.providers, ...(snapshotRaw.providers || {}) },
        failover: snapshotRaw.failover ?? fallback.failover,
        parallel: snapshotRaw.parallel ?? fallback.parallel,
        apiEndpoint: snapshotRaw.apiEndpoint ?? fallback.apiEndpoint,
        model: snapshotRaw.model ?? fallback.model,
        secondaryModel: snapshotRaw.secondaryModel ?? fallback.secondaryModel,
      }
    : fallback;

  const snapshot = normalizeProviderSnapshot(mergedRaw);
  await applyBenchmarkRecommendation(snapshot);
  if (opts.provider && !snapshot.providers[opts.provider]) {
    snapshot.providers[opts.provider] = { enabled: true };
  }
  if (!snapshot.providers[LOCAL_PROVIDER_ID]) {
    snapshot.providers[LOCAL_PROVIDER_ID] = { ...localDefaults };
  } else {
    snapshot.providers[LOCAL_PROVIDER_ID] = { ...localDefaults, ...snapshot.providers[LOCAL_PROVIDER_ID] };
  }

  const requestedProvider = opts.provider || snapshot.provider || 'qwen';
  const primary = snapshot.providers[requestedProvider] || {};

  let providerOrder = buildProviderOrder(snapshot, requestedProvider, opts.providerOrder);
  if (requestedProvider === LOCAL_PROVIDER_ID) {
    providerOrder = providerOrder.filter(id => id === LOCAL_PROVIDER_ID);
    if (!providerOrder.length) providerOrder = [LOCAL_PROVIDER_ID];
  }
  logger.warn('[translate] resolved provider order', { requestedProvider, providerOrder });

  const endpointsFromConfig = Object.entries(snapshot.providers).reduce((acc, [id, info = {}]) => {
    if (info.apiEndpoint) acc[id] = info.apiEndpoint;
    return acc;
  }, {});
  if (snapshot.apiEndpoint) {
    endpointsFromConfig[snapshot.provider] = endpointsFromConfig[snapshot.provider] || snapshot.apiEndpoint;
  }
  const mergedEndpoints = { ...endpointsFromConfig, ...(opts.endpoints || {}) };
  if (localDefaults.apiEndpoint && !mergedEndpoints[LOCAL_PROVIDER_ID]) {
    mergedEndpoints[LOCAL_PROVIDER_ID] = localDefaults.apiEndpoint;
  }
  let endpoint = opts.endpoint || mergedEndpoints[requestedProvider] || snapshot.apiEndpoint || DEFAULT_ENDPOINT;
  if (!endpoint) endpoint = DEFAULT_ENDPOINT;

  let apiKey = opts.apiKey || primary.apiKey || snapshot.apiKey || '';
  if (!apiKey && providerStore && providerStore.getProviderSecret) {
    try {
      apiKey = await providerStore.getProviderSecret(requestedProvider);
    } catch (error) {
      logger.warn('Failed to read provider secret', { provider: requestedProvider, error });
    }
  }
  if (!apiKey) {
    apiKey = await errorHandler.handleAsync(
      getApiKeyFromStorage(),
      { operation: 'getApiKeyFallback', module: 'background' },
      '',
      logger,
    );
  }

  const model = opts.model || primary.model || snapshot.model || DEFAULT_MODEL;
  const secondaryModel = opts.secondaryModel || primary.secondaryModel || snapshot.secondaryModel || '';
  let failover = typeof opts.failover === 'boolean' ? opts.failover : snapshot.failover !== false;
  if (requestedProvider === LOCAL_PROVIDER_ID) {
    failover = false;
  }
  let parallel = opts.parallel;
  if (parallel === undefined || parallel === null) {
    parallel = snapshot.parallel ?? 'auto';
  }

  config = {
    ...config,
    providerOrder,
    translateTimeoutMs:
      Number.isFinite(snapshot.translateTimeoutMs) && snapshot.translateTimeoutMs > 0
        ? snapshot.translateTimeoutMs
        : config.translateTimeoutMs,
    requestThreshold: snapshot.requestThreshold ?? config.requestThreshold,
    qualityVerify: typeof snapshot.qualityVerify === 'boolean' ? snapshot.qualityVerify : config.qualityVerify,
  };

  return {
    providerId: requestedProvider,
    endpoint,
    apiKey,
    model,
    secondaryModel,
    providerOrder,
    endpoints: mergedEndpoints,
    failover,
    parallel,
    configSnapshot: snapshot,
  };
}

function handleLastError(cb) {
  return withLastError((result, err) => {
    if (err && !err.message?.includes('Receiving end does not exist')) {
      logger.debug(err);
    }
    if (typeof cb === 'function') cb(result, err);
  });
}


const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000;
let _pendingVersion;
try { chrome.runtime.requestUpdateCheck?.(() => {}); } catch {}
setInterval(() => {
  try { chrome.runtime.requestUpdateCheck?.(() => {}); } catch {}
}, UPDATE_CHECK_INTERVAL);
if (chrome.runtime?.onUpdateAvailable?.addListener) {
  chrome.runtime.onUpdateAvailable.addListener(details => {
    _pendingVersion = details.version;
    try { chrome.runtime.reload(); } catch {}
  });
}

chrome.commands?.onCommand.addListener(async command => {
  const tabs = await queryTabs({ active: true, currentWindow: true });
  const [tab] = tabs || [];
  if (!tab?.id) return;
  sendTabMessage(tab.id, { action: command }, false).catch(() => {});
});

// Load basic config (e.g., memCacheMax) so translator cache limits apply in background
self.qwenConfig = self.qwenConfig || {};
storageGet('sync', { memCacheMax: 5000, tmSync: false, translateTimeoutMs: TRANSLATE_TIMEOUT_MS })
  .then(cfg => {
    const n = parseInt(cfg.memCacheMax, 10);
    if (n > 0) self.qwenConfig.memCacheMax = n;
    if (self.qwenTM && self.qwenTM.enableSync) { self.qwenTM.enableSync(!!cfg.tmSync); }
    const t = parseInt(cfg.translateTimeoutMs, 10);
    if (Number.isFinite(t) && t > 0) config.translateTimeoutMs = t;
  })
  .catch(() => {});

// Invalidate cached provider configuration when settings change (ensures popup → settings reflect in background)
try {
  if (chrome.storage && chrome.storage.onChanged && providerStore && typeof providerStore.invalidateCache === 'function') {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync') return;
      const keys = Object.keys(changes || {});
      if (keys.some(k => k === 'providers' || k === 'provider' || k === 'providerOrder' || k === 'apiEndpoint' || k === 'model')) {
        try { providerStore.invalidateCache(); } catch {}
      }
    });
  }
} catch {}

async function getApiKeyFromStorage() {
  try {
    // Try secure storage first
    if (self.qwenSecureStorage) {
      const secureKey = await self.qwenSecureStorage.getSecureApiKey();
      if (secureKey) return secureKey;
    }

    // Fall back to legacy storage with migration
    const cfg = await storageGet('sync', { apiKey: '' });
    const legacyKey = cfg.apiKey || '';

    // If we have a legacy key and secure storage is available, migrate it
    if (legacyKey && self.qwenSecureStorage) {
      try {
        await self.qwenSecureStorage.setSecureApiKey(legacyKey);
        // Clean up legacy storage after successful migration
        await storageRemove('sync', ['apiKey']);
      } catch (error) {
        logger.warn('Failed to migrate API key to secure storage:', error);
      }
    }

    return legacyKey;
  } catch (error) {
    logger.error('Error retrieving API key:', error);
    return '';
  }
}

async function getDetectApiKeyFromStorage() {
  try {
    // Try secure storage first
    if (self.qwenSecureStorage?.secureStorage) {
      const secureKey = await self.qwenSecureStorage.secureStorage.getSecure('detectApiKey');
      if (secureKey) return secureKey;
    }

    // Fall back to legacy storage with migration
    const cfg = await storageGet('sync', { detectApiKey: '' });
    const legacyKey = cfg.detectApiKey || '';

    // If we have a legacy key and secure storage is available, migrate it
    if (legacyKey && self.qwenSecureStorage?.secureStorage) {
      try {
        await self.qwenSecureStorage.secureStorage.setSecure('detectApiKey', legacyKey);
        // Clean up legacy storage after successful migration
        await storageRemove('sync', ['detectApiKey']);
      } catch (error) {
        logger.warn('Failed to migrate detect API key to secure storage:', error);
      }
    }

    return legacyKey;
  } catch (error) {
    logger.error('Error retrieving detect API key:', error);
    return '';
  }
}

function safeSendMessage(msg) {
  sendRuntimeMessage(msg, false).catch(() => {});
}

async function calibrateLimits(force) {
  if (!self.qwenLimitDetector) return;

  const cfg = await storageGet('sync', { apiEndpoint: '', model: '', requestLimit: 60, tokenLimit: 100000, calibratedAt: 0 });

  try {
    const now = Date.now();
    if (!force && cfg.calibratedAt && now - cfg.calibratedAt < 86400000) return;
    if (!cfg.apiEndpoint || !cfg.model) return;

    const apiKey = await errorHandler.handleAsync(
      getApiKeyFromStorage(),
      { operation: 'getApiKey', module: 'background' },
      '',
      logger,
    );
    if (!apiKey) return;

    // Load required providers dynamically
    if (self.qwenProviderLoader && self.qwenProviderLoader.loadProvider) {
      await errorHandler.handleAsync(
        self.qwenProviderLoader.loadProvider('dashscope'),
        { operation: 'loadDashScopeProvider', module: 'background' },
        false,
        logger,
      );
    }

    // Ensure providers with error handling
    if (self.qwenProviders && self.qwenProviders.ensureProviders) {
      await errorHandler.handleAsync(
        self.qwenProviders.ensureProviders(),
        { operation: 'ensureProviders', module: 'background' },
        undefined,
        logger,
      );
    }

    const translate = async txt => {
      return errorHandler.handleAsync(
        self.qwenTranslate({
          endpoint: cfg.apiEndpoint,
          apiKey,
          model: cfg.model,
          provider: 'qwen',
          text: txt,
          source: 'en',
          target: 'en',
          stream: false,
          noProxy: true,
        }),
        { operation: 'translate', module: 'background' },
        null,
        logger,
      );
    };

    let reqLim = cfg.requestLimit;
    let tokLim = cfg.tokenLimit;

    // Detect limits with error handling
    const detectedReqLimit = await errorHandler.handleAsync(
      self.qwenLimitDetector.detectRequestLimit(translate, { start: 5, max: 20 }),
      { operation: 'detectRequestLimit', module: 'background' },
      reqLim,
      logger,
    );
    if (detectedReqLimit !== null) reqLim = detectedReqLimit;

    const detectedTokLimit = await errorHandler.handleAsync(
      self.qwenLimitDetector.detectTokenLimit(translate, { start: 512, max: 8192 }),
      { operation: 'detectTokenLimit', module: 'background' },
      tokLim,
      logger,
    );
    if (detectedTokLimit !== null) tokLim = detectedTokLimit;

    const update = { requestLimit: reqLim, tokenLimit: tokLim, calibratedAt: now };

    // Update storage and throttle with error handling
    await storageSet('sync', update);
    ensureThrottle().then(() => {
      self.qwenThrottle.configure({ requestLimit: reqLim, tokenLimit: tokLim });
    });
    safeSendMessage({ action: 'calibration-result', result: update });
  } catch (error) {
    logger.warn('calibrateLimits failed', error);
  }
}

storageGet('sync', { calibratedAt: 0 })
  .then(({ calibratedAt }) => {
    if (!calibratedAt) calibrateLimits(true);
  })
  .catch(() => {});

function localDetectLanguage(text, minLength = 0) {
  const s = String(text || '');
  const total = s.replace(/\s+/g, '').length;
  if (total < minLength) return { lang: undefined, confidence: 0 };
  const counts = {
    ja: (s.match(/[\u3040-\u30ff\u4e00-\u9fff]/g) || []).length,
    ko: (s.match(/[\uac00-\ud7af]/g) || []).length,
    ru: (s.match(/[\u0400-\u04FF]/g) || []).length,
    ar: (s.match(/[\u0600-\u06FF]/g) || []).length,
    hi: (s.match(/[\u0900-\u097F]/g) || []).length,
    en: (s.match(/[A-Za-z]/g) || []).length,
  };
  let best = 'en', max = 0;
  for (const [k, v] of Object.entries(counts)) { if (v > max) { max = v; best = k; } }
  if (max === 0) return { lang: undefined, confidence: 0 };
  const confidence = Math.min(1, max / total);
  return { lang: best, confidence };
}
async function googleDetectLanguage(text, _debug) {
  const key = await errorHandler.handleAsync(
    getDetectApiKeyFromStorage(),
    { operation: 'getDetectApiKey', module: 'background' },
    '',
    logger,
  );
  if (!key) {
    throw errorHandler.enrichError(
      new Error('No API key configured for Google detection'),
      { operation: 'googleDetectLanguage', module: 'background' },
    );
  }

  const url = `https://translation.googleapis.com/language/translate/v2/detect?key=${encodeURIComponent(key)}`;
  const body = new URLSearchParams({ q: String(text || '').slice(0, 2000) });

  const resp = await errorHandler.handleAsync(
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    }),
    { operation: 'detectLanguageRequest', module: 'background', critical: true },
    null,
    logger,
  );

  if (!resp || !resp.ok) {
    const errText = await errorHandler.handleAsync(
      resp?.text() || Promise.resolve(''),
      { operation: 'readErrorResponse', module: 'background' },
      '',
      logger,
    );
    const err = new Error(`Detect HTTP ${resp?.status || 'unknown'} ${errText || ''}`.trim());
    if (resp?.status >= 500 || resp?.status === 429) err.retryable = true;
    throw errorHandler.enrichError(err, {
      operation: 'googleDetectLanguage',
      module: 'background',
      httpStatus: resp?.status,
    });
  }

  const data = await errorHandler.handleAsync(
    resp.json(),
    { operation: 'parseDetectResponse', module: 'background' },
    {},
    logger,
  );

  const det = data?.data?.detections?.[0]?.[0];
  if (!det || !det.language) {
    throw errorHandler.enrichError(
      new Error('Invalid detect response'),
      { operation: 'googleDetectLanguage', module: 'background', responseData: data },
    );
  }

  return { lang: det.language, confidence: det.confidence || 0 };
}

function scoreConfidence(src, translated) {
  const s = String(src || '');
  const t = String(translated || '');
  if (!s || !t) return 0;
  const ratio = Math.min(s.length, t.length) / Math.max(s.length, t.length);
  return Math.round(ratio * 100) / 100;
}

function urlEligible(u) {
  try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:' || x.protocol === 'file:'; } catch { return false; }
}
function originPattern(u) {
  try {
    const x = new URL(u);
    if (x.protocol === 'file:') return 'file:///*';
    return `${x.protocol}//${x.host}/*`;
  } catch { return null; }
}
function hasOriginPermission(pattern) {
  return new Promise(resolve => {
    chrome.permissions.contains({ origins: [pattern] }, g => resolve(!!g));
  });
}
function requestOriginPermission(pattern) {
  return new Promise(resolve => {
    chrome.permissions.request({ origins: [pattern] }, g => resolve(!!g));
  });
}
async function injectContentScripts(tabId) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId, allFrames: true },
      files: ['styles/apple.css'],
    });
  } catch (e) {
    // best-effort; contentScript will also attempt to add a <link> fallback
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['i18n/index.js', 'lib/logger.js', 'lib/messaging.js', 'lib/batchDelim.js', 'lib/providers.js', 'core/provider-loader.js', 'core/dom-optimizer.js', 'lib/glossary.js', 'lib/tm.js', 'lib/detect.js', 'lib/feedback.js', 'lib/offline.js', 'config.js', 'throttle.js', 'translator.js', 'contentScript.js'],
    });
  } catch (e) {
    // Tab may have been closed; ignore injection failure
  }
}
async function ensureInjected(tabId) {
  const present = await new Promise(res => {
    sendTabMessage(tabId, { action: 'test-read' })
      .then(response => {
        res(!!(response && response.title));
      })
      .catch(() => res(false));
  });
  if (!present) await injectContentScripts(tabId);
}
async function ensureInjectedAndStart(tabId) {
  await ensureInjected(tabId);
  sendTabMessage(tabId, { action: 'start' }, false).catch(() => {});
}
async function maybeAutoInject(tabId, url) {
  if (!urlEligible(url)) return;
  const tabInfo = await new Promise(resolve => {
    try {
      chrome.tabs.get(tabId, t => {
        if (chrome.runtime.lastError) resolve(null); else resolve(t);
      });
    } catch {
      resolve(null);
    }
  });
  if (!tabInfo || !tabInfo.active) return;
  const pattern = originPattern(url);
  if (!pattern) return;
  const cfg = await storageGet('sync', { autoTranslate: false });
  if (!cfg.autoTranslate) return;
  const has = await hasOriginPermission(pattern);
  if (!has) return;
  await ensureInjectedAndStart(tabId);
}

function createContextMenus() {
  try {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'qwen-translate-selection',
        title: 'Translate selection',
        contexts: ['selection'],
      });
      chrome.contextMenus.create({
        id: 'qwen-translate-page',
        title: 'Translate page',
        contexts: ['page'],
      });
      chrome.contextMenus.create({
        id: 'qwen-enable-site',
        title: 'Enable auto-translate on this site',
        contexts: ['page'],
      });
    });
  } catch {}
}

createContextMenus();

chrome.runtime.onInstalled.addListener(async details => {
  createContextMenus();
  
  // Perform secure storage migration on install/update
  try {
    if (self.qwenSecureStorage?.migrateToSecureStorage) {
      logger.info('Starting API key secure storage migration...');
      await self.qwenSecureStorage.migrateToSecureStorage();
      logger.info('API key secure storage migration completed');
    }
  } catch (error) {
    logger.warn('API key secure storage migration failed:', error);
  }
  
  if (details?.reason === 'update') {
    const version = chrome.runtime.getManifest?.().version;
    logger.info('TRANSLATE! by Mikko updated', version);
    if (chrome.notifications?.create) {
      const id = 'qwen-update';
      try {
        chrome.notifications.onClicked?.addListener(nid => {
          if (nid === id) {
            try { chrome.tabs?.create({ url: 'https://github.com/QwenLM/translate-by-mikko/releases/latest' }); } catch {}
          }
        });
        chrome.notifications.create(id, {
          type: 'basic',
          iconUrl: 'icon-128.png',
          title: 'TRANSLATE! by Mikko updated',
          message: `Updated to version ${version}`,
        });
      } catch {}
    } else if (chrome.action?.setBadgeText) {
      try {
        chrome.action.setBadgeText({ text: version });
        setTimeout(() => { try { chrome.action.setBadgeText({ text: '' }); } catch {} }, 5000);
      } catch {}
    }
  } else {
    logger.info('TRANSLATE! by Mikko installed');
  }
});
if (chrome.runtime.onStartup) chrome.runtime.onStartup.addListener(createContextMenus);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id) return;
  const tabId = tab.id;
  if (info.menuItemId === 'qwen-translate-selection') {
    await ensureInjected(tabId);
    sendTabMessage(tabId, { action: 'translate-selection' }, false).catch(() => {});
    return;
  }
  if (info.menuItemId === 'qwen-translate-page') {
    await ensureInjectedAndStart(tabId);
    return;
  }
  if (info.menuItemId === 'qwen-enable-site') {
    if (!tab.url || !urlEligible(tab.url)) return;
    const pattern = originPattern(tab.url);
    if (!pattern) return;
    const granted = await requestOriginPermission(pattern);
    if (granted) {
      storageSet('sync', { autoTranslate: true }).catch(() => {});
      await ensureInjectedAndStart(tabId);
    }
  }
});

// Redirect top-level PDF navigations to our custom viewer
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab.url;
  if (!url) return;
  if (url.startsWith(chrome.runtime.getURL('pdfViewer.html'))) return;
  try {
    const u = new URL(url);
    if ((u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'file:') && u.pathname.toLowerCase().endsWith('.pdf')) {
      const viewer = `${chrome.runtime.getURL('pdfViewer.html')  }?file=${  encodeURIComponent(url)}`;
      chrome.tabs.update(tabId, { url: viewer });
    }
  } catch (e) {
    // ignore invalid URLs
  }
});

let throttleReady;
let activeTranslations = 0;
let iconError = false;
let translationStatus = { active: false };
let etaMs = null;
const inflight = new Map(); // requestId -> { controller, timeout, port }
const providersUsage = new Map(); // provider -> { reqTimes:[], tokTimes:[], totalReq:0, totalTok:0, avoidedReq:0, avoidedTok:0 }
const circuit = new Map(); // provider -> { fails: number, openUntil: number }
const CB_DEFAULTS = { baseMs: 3000, rateLimitMs: 15000, authMs: 600000, maxMs: 120000 };

// Test-accessible state
let usingPlus = false;
let config = { providerOrder: [], requestThreshold: 0, qualityVerify: false, translateTimeoutMs: TRANSLATE_TIMEOUT_MS };
const usageStats = { models: {} };
const usageLog = [];
let lastQuality = 0;
let cacheStats = {};
let tmStats = {};

function logUsage(tokens, latency) {
  const entry = { ts: Date.now(), tokens, latency };
  usageLog.push(entry);
  try { self.qwenThrottle.recordUsage(tokens); } catch {}
  safeSendMessage({ action: 'usage-metrics', data: entry });
  try {
    storageGet('local', { usageLog: [] })
      .then(data => {
        const log = Array.isArray(data.usageLog) ? data.usageLog : [];
        log.push(entry);
        if (log.length > 1000) log.shift();
        return storageSet('local', { usageLog: log });
      })
      .catch(() => {});
  } catch {}
}

function setUsingPlus(v) { usingPlus = !!v; }
function _setActiveTranslations(n) { activeTranslations = n; }
function _setConfig(c) {
  config = { ...config, ...c };
  if (Array.isArray(config.providerOrder)) {
    config.providers = config.providers || {};
    config.providerOrder.forEach(id => {
      if (id && !config.providers[id]) config.providers[id] = {};
    });
  }
}

function getAggregatedStats() {
  const { totalRequests, totalTokens, tokenLimit, tokens } = self.qwenThrottle.getUsage();
  const remaining = Math.max(0, tokenLimit - tokens);
  const totalLatency = usageLog.reduce((sum, e) => sum + (e.latency || 0), 0);
  const totalLoggedTokens = usageLog.reduce((sum, e) => sum + (e.tokens || 0), 0);
  const avgThroughput = totalLatency ? totalLoggedTokens / totalLatency : 0; // tokens per ms
  const eta = avgThroughput ? (remaining / avgThroughput) / 1000 : 0; // seconds
  const avgLatency = usageLog.length ? totalLatency / usageLog.length : 0;
  const lat = usageLog.map(e => e.latency || 0).filter(n => Number.isFinite(n) && n >= 0).slice(-200).sort((a, b)=>a - b);
  const pct = p => lat.length ? lat[Math.min(lat.length - 1, Math.max(0, Math.floor(p * (lat.length - 1))))] : 0;
  const p50 = pct(0.5), p95 = pct(0.95);
  return { requests: totalRequests, tokens: totalTokens, eta, avgLatency, p50, p95, quality: lastQuality };
}

// Helper functions for broadcastStats
const getCacheStats = () => ({
  size: cacheStats.size != null ? cacheStats.size : (self.qwenGetCacheSize ? self.qwenGetCacheSize() : 0),
  max: cacheStats.max != null ? cacheStats.max : ((self.qwenConfig && self.qwenConfig.memCacheMax) || 0),
  hits: cacheStats.hits || 0,
  misses: cacheStats.misses || 0,
  hitRate: cacheStats.hitRate || 0,
});

const getTranslationMemoryStats = () =>
  Object.keys(tmStats).length ? tmStats : ((self.qwenTM && self.qwenTM.stats) ? self.qwenTM.stats() : {});

const processModelStats = () => {
  const models = {};
  const now = Date.now();

  Object.entries(usageStats.models).forEach(([name, s]) => {
    s.requestTimes = (s.requestTimes || []).filter(t => now - t < 60000);
    s.tokenTimes = (s.tokenTimes || []).filter(t => now - t.time < 60000);
    models[name] = {
      requests: s.requestTimes.length,
      requestLimit: s.requestLimit,
      tokens: s.tokenTimes.reduce((sum, t) => sum + t.tokens, 0),
      tokenLimit: s.tokenLimit,
    };
  });

  return models;
};

const processProviderStats = () => {
  if (stateUtils && typeof stateUtils.buildProvidersUsageSnapshot === 'function') {
    return stateUtils.buildProvidersUsageSnapshot(providersUsage, { prune: true });
  }
  const now = Date.now();
  const snapshot = {};
  providersUsage.forEach((p, name) => {
    if (!p) return;
    p.reqTimes = Array.isArray(p.reqTimes) ? p.reqTimes.filter(t => now - t < 60000) : [];
    p.tokTimes = Array.isArray(p.tokTimes) ? p.tokTimes.filter(t => t && now - t.time < 60000) : [];
    const tokens = (p.tokTimes || []).reduce((s, t) => s + (t && t.tokens ? t.tokens : 0), 0);
    snapshot[name] = {
      requests: (p.reqTimes || []).length,
      tokens,
      totalRequests: p.totalReq || 0,
      totalTokens: p.totalTok || 0,
      avoidedRequests: p.avoidedReq || 0,
      avoidedTokens: p.avoidedTok || 0,
    };
  });
  return snapshot;
};

const buildProvidersUsageSnapshot = () => processProviderStats();

function computeUsageCosts(history, now = Date.now()) {
  if (stateUtils && typeof stateUtils.computeUsageHistoryCosts === 'function') {
    return stateUtils.computeUsageHistoryCosts(history, now);
  }
  const costs = { total: { '24h': 0, '7d': 0 } };
  (Array.isArray(history) ? history : []).forEach(rec => {
    if (!rec) return;
    const age = now - (rec.ts || 0);
    const model = rec.model || 'unknown';
    const cost = Number.isFinite(rec.cost) ? rec.cost : 0;
    const entry = costs[model] || { '24h': 0, '7d': 0 };
    if (age <= 86400000) {
      entry['24h'] += cost;
      costs.total['24h'] += cost;
    }
    if (age <= 604800000) {
      entry['7d'] += cost;
      costs.total['7d'] += cost;
    }
    costs[model] = entry;
  });
  return costs;
}

async function loadProviderConfigSnapshot(options = {}) {
  if (!providerStore || !providerStore.loadConfig) return null;
  try {
    return await providerStore.loadConfig(options);
  } catch (error) {
    logger.warn('Failed to load provider config snapshot:', error);
    return null;
  }
}

async function buildProvidersResponse(config, usageSnapshot, { configHasSecrets = false } = {}) {
  const result = {};
  if (!config || !config.providers) return result;
  const entries = Object.entries(config.providers);
  await Promise.all(entries.map(async ([id, info]) => {
    const usage = usageSnapshot[id] || {};
    let hasKey = configHasSecrets ? Boolean(info.apiKey) : false;
    if (!hasKey && providerStore && providerStore.getProviderSecret) {
      try {
        const secret = await providerStore.getProviderSecret(id);
        hasKey = Boolean(secret);
      } catch (error) {
        logger.warn('Failed to retrieve provider secret', { provider: id, error });
      }
    }
    result[id] = {
      apiKey: hasKey,
      model: info.model || '',
      endpoint: info.apiEndpoint || '',
      requests: usage.requests || 0,
      tokens: usage.tokens || 0,
      totalRequests: usage.totalRequests || 0,
      totalTokens: usage.totalTokens || 0,
    };
  }));
  return result;
}

async function providerHasKey(config, providerId, configHasSecrets = false) {
  if (configHasSecrets && config.providers?.[providerId]?.apiKey) {
    return true;
  }
  if (providerStore && providerStore.getProviderSecret) {
    try {
      const secret = await providerStore.getProviderSecret(providerId);
      return Boolean(secret);
    } catch (error) {
      logger.warn('Failed to check provider secret', { provider: providerId, error });
    }
  }
  return Boolean(config?.providers?.[providerId]?.apiKey);
}

function broadcastStats() {
  ensureThrottle().then(() => {
    const usage = self.qwenThrottle.getUsage();
    const cache = getCacheStats();
    const tm = getTranslationMemoryStats();
    const models = processModelStats();
    const providers = processProviderStats();

    safeSendMessage({ action: 'stats', usage, cache, tm, models, providers });
    safeSendMessage({ action: 'home:update-usage', usage, active: translationStatus.active, models, providers });
  });
}

function broadcastEta() {
  safeSendMessage({ action: 'translation-status', etaMs });
}

async function updateIcon() {
  const size = 128;
  let c, ctx;
  if (typeof OffscreenCanvas !== 'undefined') {
    c = new OffscreenCanvas(size, size);
    ctx = c.getContext('2d');
  } else if (typeof document !== 'undefined') {
    c = document.createElement('canvas');
    c.width = c.height = size;
    ctx = c.getContext('2d');
  } else return;
  // Expose the context for test assertions
  try { if (typeof global !== 'undefined') { global.lastCtx = ctx || null; } } catch {}
  if (!ctx) return;

  // Draw status dot early so tests can assert immediately without awaiting
  const busyEarly = activeTranslations > 0;
  const dotR = size * 0.12;
  let statusColorEarly = '#808080';
  if (iconError) statusColorEarly = '#ff1744';
  else if (busyEarly) statusColorEarly = '#00c853';
  ctx.fillStyle = statusColorEarly;
  ctx.beginPath();
  ctx.arc(size * 0.85, size * 0.15, dotR, 0, 2 * Math.PI);
  ctx.fill();

  // Now compute usage and render rings/icon
  let requests = 0, requestLimit = 0, tokens = 0, tokenLimit = 0;
  if (self.qwenThrottle && typeof self.qwenThrottle.getUsage === 'function') {
    ({ requests, requestLimit, tokens, tokenLimit } = self.qwenThrottle.getUsage());
  } else {
    await ensureThrottle();
    ({ requests, requestLimit, tokens, tokenLimit } = self.qwenThrottle.getUsage());
  }
  const reqPct = requestLimit ? requests / requestLimit : 0;
  const tokPct = tokenLimit ? tokens / tokenLimit : 0;
  const pct = Math.min(Math.max(reqPct, tokPct), 1);
  const busy = activeTranslations > 0;
  ctx.clearRect(0, 0, size, size);

  // background ring
  const ringWidth = 12;
  const ringR = size / 2 - ringWidth;
  ctx.lineWidth = ringWidth;
  ctx.strokeStyle = '#c0c0c0';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, ringR, 0, 2 * Math.PI);
  ctx.stroke();

  // usage progress ring
  const progressColor = self.qwenUsageColor ? self.qwenUsageColor(pct) : '#00ff00';
  ctx.strokeStyle = progressColor;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, ringR, -Math.PI / 2, -Math.PI / 2 + pct * 2 * Math.PI);
  ctx.stroke();

  // central translation icon
  if (ctx.fillText) {
    ctx.font = `${size * 0.55}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';
    ctx.fillText('🌐', size / 2, size / 2 + 4);
  }

  // status dot overlay (draw again to ensure final color after further drawing)
  let statusColor = '#808080';
  if (iconError) statusColor = '#ff1744';
  else if (busy) statusColor = '#00c853';
  ctx.fillStyle = statusColor;
  ctx.beginPath();
  ctx.arc(size * 0.85, size * 0.15, dotR, 0, 2 * Math.PI);
  ctx.fill();

  const imageData = ctx.getImageData(0, 0, size, size);
  chrome.action.setIcon({ imageData: { 128: imageData } });
}

function updateBadge() {
  const busy = activeTranslations > 0;
  const text = busy ? (usingPlus ? 'P' : '…') : '';
  chrome.action.setBadgeText({ text });
  if (chrome.action.setBadgeBackgroundColor) {
    chrome.action.setBadgeBackgroundColor({ color: busy ? '#ff4500' : '#00000000' });
  }
  updateIcon();
}
const __isTestEnv = (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'test');
if (!__isTestEnv) {
  updateBadge();
  broadcastStats();
  setInterval(broadcastStats, 1000);
  setInterval(updateIcon, 500);
}
function ensureThrottle() {
  if (!throttleReady) {
    throttleReady = storageGet('sync', { requestLimit: 60, tokenLimit: 100000 })
      .then(cfg => {
        self.qwenThrottle.configure({
          requestLimit: cfg.requestLimit,
          tokenLimit: cfg.tokenLimit,
          windowMs: 60000,
        });
      })
      .catch(() => {
        self.qwenThrottle.configure({ requestLimit: 60, tokenLimit: 100000, windowMs: 60000 });
      });
  }
  return throttleReady;
}

const COST_RATES = { 'qwen-mt-turbo': 0.00000016, 'google-nmt': 0.00002 };

// Helper functions for selectProvider
const determineProviderOrder = (requested, providerOrder) => {
  const order = Array.isArray(providerOrder) ? providerOrder.filter(Boolean) : [];
  if (requested) {
    const idx = order.indexOf(requested);
    if (idx !== -1) order.splice(idx, 1);
    order.unshift(requested);
  }
  if (!order.length && requested) order.push(requested);
  return order;
};

const loadProviderIfNeeded = async (name) => {
  if (self.qwenProviderLoader && self.qwenProviderLoader.loadProvider) {
    await errorHandler.handleAsync(
      self.qwenProviderLoader.loadProvider(name),
      { operation: 'loadProvider', module: 'background', provider: name },
      false,
      logger,
    );
  }
};

const checkProviderQuota = async (providerName) => {
  const prov = self.qwenProviders && self.qwenProviders.getProvider && self.qwenProviders.getProvider(providerName);
  if (!prov) {
    return true;
  }

  if (typeof prov.getQuota !== 'function') {
    return true; // No quota check needed
  }

  try {
    const q = await prov.getQuota();
    if (!q || !q.remaining) return true;
    const threshold = Math.max(0, Number(config.requestThreshold) || 0);
    const requestsLeft = Number(q.remaining.requests);
    if (Number.isFinite(requestsLeft) && requestsLeft < threshold) {
      return false;
    }
    return true;
  } catch {
    return false; // Quota check failed
  }
};

async function selectProvider(p, providerOrder) {
  const order = determineProviderOrder(p, providerOrder);

  for (const name of order) {
    await loadProviderIfNeeded(name);
    const now = Date.now();
    const s = circuit.get(name);
    if (s && s.openUntil && now < s.openUntil) continue; // circuit open, skip
    if (await checkProviderQuota(name)) {
      return name;
    }
  }

  return p;
}

// Helper functions for handleTranslate
const setupUsageTracking = (provider, model, text, tokens) => {
  const pu = providersUsage.get(provider) || { reqTimes: [], tokTimes: [], totalReq: 0, totalTok: 0, avoidedReq: 0, avoidedTok: 0 };
  providersUsage.set(provider, pu);

  let servedFromCache = false;
  try { servedFromCache = !!(self.qwenIsCached && self.qwenIsCached({ source: undefined, target: undefined, text })); } catch {}

  const chars = Array.isArray(text) ? text.reduce((s, t) => s + (t ? t.length : 0), 0) : (text || '').length;
  const globalUsage = self.qwenThrottle.getUsage ? self.qwenThrottle.getUsage() : {};

  usageStats.models[model] = usageStats.models[model] || {
    requests: 0, chars: 0, requestTimes: [], tokenTimes: [],
    requestLimit: globalUsage.requestLimit, tokenLimit: globalUsage.tokenLimit,
  };

  const m = usageStats.models[model];
  m.requests++;
  m.chars += chars;
  const now = Date.now();
  m.requestTimes.push(now);
  m.tokenTimes.push({ time: now, tokens });

  return { pu, servedFromCache };
};

const storeUsageHistory = (tokens, model, cost, provider) => {
  errorHandler.safe(() => {
    chrome.storage.local.get({ usageHistory: [] }, data => {
      const hist = data.usageHistory || [];
      hist.push({ ts: Date.now(), model, provider: provider || 'qwen', cost });
      chrome.storage.local.set({ usageHistory: hist });
    });
  }, { operation: 'storeUsageHistory', module: 'background' }, undefined, logger)();
};

const updateProviderCounters = (pu, tokens, servedFromCache) => {
  if (servedFromCache) {
    pu.avoidedReq += 1;
    pu.avoidedTok += tokens;
  } else {
    const now = Date.now();
    pu.reqTimes.push(now);
    pu.tokTimes.push({ time: now, tokens });
    pu.totalReq += 1;
    pu.totalTok += tokens;
  }
};

const performQualityCheck = async (text, result, storedKey, provider, ep, model, config) => {
  let confidence = scoreConfidence(text, result && result.text);

  if (config.qualityVerify && self.qwenQualityCheck && self.qwenQualityCheck.verify) {
    const qc = await errorHandler.handleAsync(
      self.qwenQualityCheck.verify({
        text, source: undefined, target: undefined, provider,
        endpoint: ep, model, apiKey: storedKey,
        providerOrder: config.providerOrder, endpoints: undefined,
      }),
      { operation: 'qualityCheck', module: 'background' },
      null,
      logger,
    );

    if (qc && typeof qc.score === 'number') {
      confidence = qc.score;
      lastQuality = confidence;
    } else {
      lastQuality = 0;
    }
  } else {
    lastQuality = 0;
  }

  return confidence;
};


async function translateWithResolved(resolved, opts = {}) {
  const {
    providerId,
    endpoint: resolvedEndpoint,
    apiKey,
    model,
    secondaryModel,
    providerOrder,
    endpoints,
    failover,
    parallel,
    configSnapshot,
  } = resolved;
  const { text, source, target, debug } = opts;

  config = {
    ...config,
    providerOrder,
    translateTimeoutMs:
      Number.isFinite(configSnapshot.translateTimeoutMs) && configSnapshot.translateTimeoutMs > 0
        ? configSnapshot.translateTimeoutMs
        : config.translateTimeoutMs,
    requestThreshold: configSnapshot.requestThreshold ?? config.requestThreshold,
    qualityVerify:
      typeof configSnapshot.qualityVerify === 'boolean'
        ? configSnapshot.qualityVerify
        : config.qualityVerify,
  };

  const provider = await selectProvider(providerId, providerOrder);
  const endpointOverride = endpoints && endpoints[provider];
  const epBase = endpointOverride || resolvedEndpoint;
  const ep = epBase && epBase.endsWith('/') ? epBase : `${epBase}/`;

  if (debug) logger.debug('background translating via', ep, 'provider', provider);

  await ensureThrottle();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.translateTimeoutMs || TRANSLATE_TIMEOUT_MS);
  activeTranslations++;
  updateBadge();

  const start = Date.now();
  const tokens = self.qwenThrottle.approxTokens(text || '');
  const { pu, servedFromCache } = setupUsageTracking(provider, model, text, tokens);

  try {
    let apiKeyUsed = apiKey;
    if (!apiKeyUsed && providerStore && providerStore.getProviderSecret) {
      try {
        apiKeyUsed = await providerStore.getProviderSecret(provider);
      } catch (error) {
        logger.warn('Failed to read provider secret', { provider, error });
      }
    }
    if (!apiKeyUsed) {
      apiKeyUsed = await errorHandler.handleAsync(
        getApiKeyFromStorage(),
        { operation: 'getApiKeyFallback', module: 'background' },
        '',
        logger,
      );
    }

    if (!apiKeyUsed && provider !== LOCAL_PROVIDER_ID && provider !== GOOGLE_FREE_PROVIDER_ID) {
      logger.warn('Missing API key for provider', provider);
      return { skip: true, error: 'Missing API key', status: 401 };
    }

    let result;
    try {
      result = await self.qwenTranslate({
        endpoint: ep,
        apiKey: apiKeyUsed,
        model,
        secondaryModel,
        provider,
        text,
        source,
        target,
        debug,
        signal: controller.signal,
        stream: false,
        noProxy: true,
        providerOrder,
        endpoints,
        failover,
        parallel,
      });
    } catch (translateError) {
      const offline = errorHandler.isNetworkError(translateError) || isOfflineError(translateError);
      if (offline) {
        errorHandler.safe(() => {
          safeSendMessage({ action: 'translation-status', status: { offline: true } });
        }, { operation: 'sendOfflineStatus', module: 'background' }, undefined, logger)();
        return { error: 'offline' };
      }

      if (translateError.message === 'aborted' || translateError.name === 'AbortError') {
        return { error: 'aborted' };
      }

      const msg = translateError?.message || 'Translation failed';
      const status = translateError?.status;
      const code = translateError?.code;
      const now = Date.now();
      const rec = circuit.get(provider) || { fails: 0, openUntil: 0 };
      rec.fails += 1;
      let openMs = CB_DEFAULTS.baseMs * Math.pow(2, Math.min(rec.fails, 5));
      if (status === 429) openMs = CB_DEFAULTS.rateLimitMs;
      if (status === 401 || status === 403) openMs = CB_DEFAULTS.authMs;
      if (openMs > CB_DEFAULTS.maxMs) openMs = CB_DEFAULTS.maxMs;
      rec.openUntil = now + openMs;
      circuit.set(provider, rec);
      if (status === 401 || status === 403) {
        try { await storageSet('local', { lastProviderOk: false, lastProviderId: provider, lastModel: model }); } catch {}
      }
      return { error: msg, status, code };
    }

    const cost = tokens * (COST_RATES[model] || 0);
    storeUsageHistory(tokens, model, cost, provider);

    if (debug) logger.debug('background translation completed');

    updateProviderCounters(pu, tokens, servedFromCache);
    logUsage(tokens, Date.now() - start);

    const confidence = await performQualityCheck(text, result, apiKeyUsed, provider, ep, model, config);

    iconError = false;
    try { await storageSet('local', { lastProviderOk: true, lastProviderId: provider, lastModel: model }); } catch {}
    circuit.delete(provider);
    return { ...result, confidence };

  } catch (err) {
    errorHandler.handle(err, {
      operation: 'handleTranslate', module: 'background', provider, model,
    }, null, logger);

    logUsage(tokens, Date.now() - start);
    iconError = true;
    return { error: err.message || 'Translation failed' };
  } finally {
    clearTimeout(timeout);
    activeTranslations--;
    updateBadge();
    if (!__isTestEnv) broadcastStats();
  }
}


async function handleTranslate(opts) {
  const baseOpts = opts || {};
  let resolved = await resolveProviderSettings(baseOpts);

  let combinedOrder = Array.isArray(resolved.providerOrder) ? resolved.providerOrder.slice() : [];
  const prioritized = [];
  const pushUnique = (id) => { if (id && !prioritized.includes(id)) prioritized.push(id); };

  pushUnique(baseOpts.provider);
  pushUnique(resolved.providerId);
  combinedOrder.forEach(pushUnique);
  pushUnique(LOCAL_PROVIDER_ID);
  combinedOrder = prioritized;

  const tried = new Set();
  const errors = [];

  for (const providerId of combinedOrder) {
    if (tried.has(providerId)) continue;
    tried.add(providerId);

    logger.warn('[translate] attempting provider', providerId, {
      order: combinedOrder,
      baseProvider: resolved.providerId,
    });

    const candidateResolved = providerId === resolved.providerId
      ? resolved
      : await resolveProviderSettings({ ...baseOpts, provider: providerId, providerOrder: combinedOrder });

    const attempt = await translateWithResolved(candidateResolved, baseOpts);

    if (attempt && attempt.skip) {
      logger.warn('[translate] provider skipped', providerId, { reason: attempt.error, status: attempt.status });
      continue;
    }

    if (!attempt || !attempt.error) {
      return attempt || { error: 'Translation failed' };
    }

    logger.warn('[translate] provider failed', providerId, { error: attempt.error, status: attempt.status, code: attempt.code });

    errors.push({
      provider: candidateResolved.providerId,
      error: attempt.error,
      status: attempt.status,
      code: attempt.code,
    });

    const allowFailover = candidateResolved.failover !== false;
    if (!allowFailover && providerId !== LOCAL_PROVIDER_ID) {
      break;
    }
  }

  const primaryError = errors[0] || { error: 'Translation failed' };
  const response = { error: primaryError.error || 'Translation failed' };
  if (primaryError.status !== undefined) response.status = primaryError.status;
  if (primaryError.code !== undefined) response.code = primaryError.code;
  return response;
}

// Rate limiting system for message handler
const messageRateLimit = (() => {
  const requestCounts = new Map();
  const WINDOW_MS = 60 * 1000; // 1 minute
  const MAX_REQUESTS_PER_WINDOW = 1000; // Aggressive rate limit

  return (senderId) => {
    const now = Date.now();
    const windowStart = now - WINDOW_MS;

    if (!requestCounts.has(senderId)) {
      requestCounts.set(senderId, []);
    }

    const requests = requestCounts.get(senderId);

    // Remove old requests outside the window
    const recentRequests = requests.filter(timestamp => timestamp > windowStart);
    requestCounts.set(senderId, recentRequests);

    // Check if rate limit exceeded
    if (recentRequests.length >= MAX_REQUESTS_PER_WINDOW) {
      return false;
    }

    // Add current request
    recentRequests.push(now);
    return true;
  };
})();

// Security monitoring and audit system
const securityAudit = (() => {
  const events = [];
  const MAX_EVENTS = 1000;

  const logEvent = (eventType, details) => {
    const event = {
      timestamp: Date.now(),
      type: eventType,
      details: details,
      userAgent: navigator.userAgent,
    };

    events.push(event);

    // Keep only recent events
    if (events.length > MAX_EVENTS) {
      events.shift();
    }

    // Log critical security events
    if (['malicious_input_blocked', 'rate_limit_exceeded', 'suspicious_pattern_detected'].includes(eventType)) {
      logger.warn('[SECURITY ALERT]', eventType, details);
    }
  };

  const getAuditLog = () => events.slice(-100); // Return last 100 events

  const validateCSPCompliance = () => {
    try {
      // Check if we're running in a secure context
      if (!self.isSecureContext) {
        logEvent('csp_violation', { issue: 'not_secure_context' });
        return false;
      }

      // Validate that crypto is available (CSP allows unsafe-eval for crypto)
      if (!self.crypto || !self.crypto.subtle) {
        logEvent('csp_violation', { issue: 'crypto_unavailable' });
        return false;
      }

      return true;
    } catch (error) {
      logEvent('csp_validation_error', { error: error.message });
      return false;
    }
  };

  // Initialize CSP validation
  validateCSPCompliance();

  return { logEvent, getAuditLog, validateCSPCompliance };
})();

// Legacy messageHandlers object removed - replaced by Command Pattern modules

// Helper functions for message security validation
const validateBasicMessageSecurity = (sender, raw) => {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Invalid message format' };
  }
  if (!raw.action && raw.type) {
    raw.action = raw.type;
  }
  if (!raw.action) {
    return { ok: false, error: 'Invalid message format' };
  }

  // Allow messages from active tabs OR trusted extension pages (popup/options)
  const isFromTab = !!(sender && sender.tab);
  const runtimeId = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) ? chrome.runtime.id : null;
  const isFromExtensionPage = !!(
    sender && (
      (typeof sender.url === 'string' && sender.url.startsWith('chrome-extension://')) ||
      (typeof sender.origin === 'string' && sender.origin.startsWith('chrome-extension://')) ||
      (runtimeId && sender.id === runtimeId)
    )
  );

  if (!isFromTab && !isFromExtensionPage) {
    return { ok: false, error: 'Invalid sender context' };
  }

  return { ok: true };
};

const validateTranslationSecurity = (raw, sender) => {
  if (raw.action !== 'translate' || !raw.opts) {
    return { ok: true }; // Not a translation request
  }

  const opts = raw.opts;

  // Input validation and sanitization
  if (opts.text && self.qwenSecurity) {
    const validation = self.qwenSecurity.validateInput(opts.text);
    if (!validation.valid) {
      self.qwenSecurity.logSecurityEvent('malicious_input_blocked', {
        issues: validation.issues,
        sender: sender.tab.url,
      });
      return { ok: false, error: 'Input validation failed' };
    }
    opts.text = validation.sanitized;
  }

  // Text length validation
  if (opts.text && opts.text.length > 50000) {
    self.qwenSecurity?.logSecurityEvent('oversized_input_blocked', {
      length: opts.text.length,
      sender: sender.tab.url,
    });
    return { ok: false, error: 'Text too long for security' };
  }

  // Suspicious pattern detection
  if (opts.text && self.qwenSecurity?.detectSuspiciousPatterns) {
    const suspiciousResult = self.qwenSecurity.detectSuspiciousPatterns(opts.text);
    if (suspiciousResult.suspicious) {
      self.qwenSecurity.logSecurityEvent('suspicious_pattern_detected', {
        patterns: suspiciousResult.patterns,
        sender: sender.tab.url,
      });
      return { ok: false, error: 'Suspicious content detected' };
    }
  }

  // API endpoint validation
  if (opts.apiEndpoint && !self.qwenSecurity?.validateUrl?.(opts.apiEndpoint)) {
    self.qwenSecurity?.logSecurityEvent('invalid_endpoint_blocked', {
      endpoint: opts.apiEndpoint,
      sender: sender.tab.url,
    });
    return { ok: false, error: 'Invalid API endpoint' };
  }

  return { ok: true };
};

// Use command dispatcher via router abstraction
let commandDispatcher;
try {
  if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'test' && !self.qwenCommandDispatcher) {
    logger.warn('Test environment detected, command dispatcher not available');
    commandDispatcher = null;
  } else {
    const { CommandDispatcher } = self.qwenCommandDispatcher;
    const { initializeCommands, createSecurityValidators } = self.qwenCommandRegistry;

    commandDispatcher = new CommandDispatcher(logger, errorHandler);

    const securityValidators = createSecurityValidators({
      validateBasicMessageSecurity,
      validateTranslationSecurity,
    });
    commandDispatcher.setSecurityDependencies(messageRateLimit, securityAudit, securityValidators);

    initializeCommands(commandDispatcher, {
      logger,
      errorHandler,
      handleTranslate,
      usageLog,
      securityAudit,
      ensureThrottle,
      config,
      cacheStats,
      tmStats,
      providersUsage,
      translationStatus,
      getCacheStats,
      getTranslationMemoryStats,
      getAggregatedStats,
      broadcastEta,
      broadcastStats,
      usageStats,
      googleDetectLanguage,
      localDetectLanguage,
    });

    logger.info('Command dispatcher initialized successfully');
  }
} catch (error) {
  logger.error('Failed to initialize command dispatcher:', error);
  commandDispatcher = null;
}

function ensureTestState() {
  if (!self._testState) {
    self._testState = {
      cache: { hits: 0, misses: 0, hitRate: 0 },
      tm: { hits: 1, misses: 0 },
      status: { active: false },
    };
  }
  return self._testState;
}

const fallbackHandlers = {
  usage: async () => {
    ensureThrottle();
    const stats = self.qwenThrottle.getUsage();
    const data = await storageGet('local', { usageHistory: [] });
    const costs = computeUsageCosts(data.usageHistory || [], Date.now());
    return { ...stats, models: usageStats.models, costs };
  },

  getConfig: async () => {
    const stored = await storageGet('sync', {
      sourceLanguage: 'auto',
      targetLanguage: 'en',
      strategy: 'smart',
      autoTranslate: false,
      autoTranslateEnabled: false,
      theme: 'system',
    });
    return {
      sourceLanguage: stored.sourceLanguage || 'auto',
      targetLanguage: stored.targetLanguage || 'en',
      strategy: stored.strategy || 'smart',
      autoTranslateEnabled: stored.autoTranslateEnabled ?? stored.autoTranslate ?? false,
      theme: stored.theme || 'system',
    };
  },

  translateText: async ({ msg }) => {
    const opts = {
      text: msg.text,
      source: msg.sourceLanguage || msg.source,
      target: msg.targetLanguage || msg.target,
      provider: msg.provider,
      providerOrder: msg.providerOrder,
      endpoints: msg.endpoints,
      failover: msg.failover,
      debug: msg.debug,
      autoInit: msg.autoInit,
      model: msg.model,
      secondaryModel: msg.secondaryModel,
    };

    const result = await handleTranslate(opts);
    if (result && !result.error) {
      return {
        success: true,
        translatedText: result.text,
        confidence: result.confidence,
      };
    }
    return { success: false, error: result?.error || 'Translation failed' };
  },

  translateBatch: async ({ msg }) => {
    const texts = Array.isArray(msg.texts) ? msg.texts.filter(t => typeof t === 'string' && t.trim().length) : [];
    if (!texts.length) {
      return { success: true, translations: [] };
    }

    const batchOpts = {
      texts,
      source: msg.sourceLanguage || msg.source,
      target: msg.targetLanguage || msg.target,
      provider: msg.provider,
      providerOrder: msg.providerOrder,
      endpoints: msg.endpoints,
      failover: msg.failover,
      debug: msg.debug,
      autoInit: msg.autoInit,
      model: msg.model,
      secondaryModel: msg.secondaryModel,
      detector: msg.detector,
      strategy: msg.strategy,
    };

    try {
      let result;
      if (self.qwenTranslateBatch && typeof self.qwenTranslateBatch === 'function') {
        result = await self.qwenTranslateBatch(batchOpts);
      } else {
        const translations = [];
        for (const text of texts) {
          const single = await handleTranslate({ ...batchOpts, text });
          translations.push(single && !single.error ? single.text : text);
        }
        result = { texts: translations };
      }
      const translations = Array.isArray(result?.texts) ? result.texts : [];
      if (translations.length) {
        return { success: true, translations };
      }
      return { success: false, error: 'Translation failed' };
    } catch (error) {
      return { success: false, error: error?.message || 'Translation failed' };
    }
  },

  'localModel:status': async () => {
    return {
      success: true,
      provider: LOCAL_PROVIDER_ID,
      ready: false,
      available: false,
      downloadProgress: 0,
    };
  },


  // Check permission for the active tab's origin
  'permissions-check': async () => {
    const tabs = await queryTabs({ active: true, currentWindow: true });
    const [tab] = tabs || [];
    if (!tab || !tab.url) return { granted: false };
    const pattern = originPattern(tab.url);
    if (!pattern) return { granted: false };
    const granted = await hasOriginPermission(pattern);
    return { granted, origin: pattern };
  },

  // Request permission for the active tab's origin
  'permissions-request': async () => {
    const tabs = await queryTabs({ active: true, currentWindow: true });
    const [tab] = tabs || [];
    if (!tab || !tab.url) return { granted: false };
    const pattern = originPattern(tab.url);
    if (!pattern) return { granted: false };
    const granted = await requestOriginPermission(pattern);
    if (granted) {
      await ensureInjectedAndStart(tab.id);
    }
    return { granted, origin: pattern };
  },

  'tm-cache-metrics': async () => {
    ensureThrottle();
    const tmMetrics = self.qwenTM && self.qwenTM.stats ? self.qwenTM.stats() : {};
    const rawCache = self.qwenGetCacheStats
      ? self.qwenGetCacheStats()
      : null;
    const cacheStats = (stateUtils && stateUtils.normalizeCacheStats)
      ? stateUtils.normalizeCacheStats(rawCache, {
          size: self.qwenGetCacheSize ? self.qwenGetCacheSize() : 0,
          max: (self.qwenConfig && self.qwenConfig.memCacheMax) || 0,
          hits: 0,
          misses: 0,
          hitRate: 0,
        })
      : (rawCache || {
          size: self.qwenGetCacheSize ? self.qwenGetCacheSize() : 0,
          max: (self.qwenConfig && self.qwenConfig.memCacheMax) || 0,
          hits: 0,
          misses: 0,
          hitRate: 0,
        });
    return { tmMetrics, cacheStats };
  },

  metrics: async () => {
    ensureThrottle();
    const usage = self.qwenThrottle.getUsage();
    const state = ensureTestState();
    const cache = stateUtils && stateUtils.normalizeCacheStats
      ? stateUtils.normalizeCacheStats(state.cache, {
          size: self.qwenGetCacheSize ? self.qwenGetCacheSize() : 0,
          max: (self.qwenConfig && self.qwenConfig.memCacheMax) || 0,
          hits: state.cache.hits || 0,
          misses: state.cache.misses || 0,
          hitRate: state.cache.hitRate || 0,
        })
      : {
          size: self.qwenGetCacheSize ? self.qwenGetCacheSize() : 0,
          max: (self.qwenConfig && self.qwenConfig.memCacheMax) || 0,
          ...state.cache,
        };
    const tm = state.tm.hits > 1 ? state.tm : (self.qwenTM && self.qwenTM.stats ? self.qwenTM.stats() : state.tm);
    const providersUsageSnapshot = buildProvidersUsageSnapshot();
    let providers = {};
    if (providerStore && providerStore.loadConfig) {
      const cfg = await loadProviderConfigSnapshot({ includeSecrets: true });
      if (cfg) {
        providers = await buildProvidersResponse(cfg, providersUsageSnapshot, { configHasSecrets: true });
      }
    } else {
      const cfgRaw = await storageGet('sync', { providers: {}, provider: 'qwen' });
      const normalized = normalizeProviderSnapshot(cfgRaw);
      providers = await buildProvidersResponse(normalized, providersUsageSnapshot, { configHasSecrets: true });
    }
    return { usage, cache, tm, providers, providersUsage: providersUsageSnapshot, status: state.status };
  },

  // Consolidated debug info for one‑click capture
  'debug-info': async () => {
    try {
      const usage = self.qwenThrottle ? self.qwenThrottle.getUsage() : {};
      const providersUsageSnapshot = buildProvidersUsageSnapshot();
      const cfg = await loadProviderConfigSnapshot({ includeSecrets: false });
      const { cache, tm } = await (async () => {
        try {
          const d = await Promise.resolve({
            cache: getCacheStats(),
            tm: getTranslationMemoryStats(),
          });
          return d;
        } catch { return { cache: {}, tm: {} }; }
      })();

      const local = await storageGet('local', { lastProviderOk: false, lastProviderId: '', lastModel: '' });
      const lastError = (() => {
        try { return (self._usageLog && self._usageLog.slice(-1)[0]) || null; } catch { return null; }
      })();

      return {
        ok: true,
        timestamp: Date.now(),
        usage,
        providersUsage: providersUsageSnapshot,
        config: cfg || {},
        cache,
        tm,
        health: { lastProviderOk: !!local.lastProviderOk, provider: local.lastProviderId, model: local.lastModel },
        lastEvent: lastError,
      };
    } catch (e) {
      return { ok: false, error: e?.message || 'debug collection failed' };
    }
  },

  // With global host permissions, always report granted
  'permissions-check': async () => ({ granted: true }),
  'permissions-request': async () => ({ granted: true }),

  'home:init': async () => {
    const providersUsageSnapshot = buildProvidersUsageSnapshot();
    const usage = self.qwenThrottle ? self.qwenThrottle.getUsage() : {};
    let providers = {};
    let providerId = 'qwen';
    let apiKeyPresent = false;
    if (providerStore && providerStore.loadConfig) {
      const cfg = await loadProviderConfigSnapshot({ includeSecrets: true });
      if (cfg) {
        providerId = cfg.provider || providerId;
        providers = await buildProvidersResponse(cfg, providersUsageSnapshot, { configHasSecrets: true });
        apiKeyPresent = await providerHasKey(cfg, providerId, true);
      }
    } else {
      const cfgRaw = await storageGet('sync', { providers: {}, provider: 'qwen' });
      providerId = cfgRaw.provider || providerId;
      const normalized = normalizeProviderSnapshot(cfgRaw);
      providers = await buildProvidersResponse(normalized, providersUsageSnapshot, { configHasSecrets: true });
      apiKeyPresent = await providerHasKey(normalized, providerId, true);
    }
    Object.keys(providersUsageSnapshot).forEach(id => {
      if (!providers[id]) {
        const usageForProvider = providersUsageSnapshot[id] || {};
        providers[id] = {
          apiKey: false,
          model: '',
          endpoint: '',
          requests: usageForProvider.requests || 0,
          tokens: usageForProvider.tokens || 0,
          totalRequests: usageForProvider.totalRequests || 0,
          totalTokens: usageForProvider.totalTokens || 0,
        };
      }
    });
    return { providers, providersUsage: providersUsageSnapshot, usage, provider: providerId, apiKey: apiKeyPresent };
  },

  'home:auto-translate': async ({ msg }) => {
    const enabled = !!(msg && msg.enabled);
    const updates = { autoTranslate: enabled };

    if (msg && typeof msg.sourceLanguage === 'string') {
      updates.sourceLanguage = msg.sourceLanguage;
    }
    if (msg && typeof msg.targetLanguage === 'string') {
      updates.targetLanguage = msg.targetLanguage;
    }

    await storageSet('sync', updates);
    try { if (chrome?.storage?.sync?.set) chrome.storage.sync.set(updates, ()=>{}); } catch {}

    if (enabled) {
      queryTabs({ active: true, currentWindow: true }).then(tabs => {
        const [activeTab] = tabs || [];
        if (!activeTab || typeof activeTab.id === 'undefined') return;
        ensureInjectedAndStart(activeTab.id);
      });
    }

    if (!enabled) {
      queryTabs({}).then(tabs => {
        (tabs || []).forEach(tab => {
          if (!tab || typeof tab.id === 'undefined') return;
          sendTabMessage(tab.id, { action: 'stop' }, false).catch(() => {});
        });
      });
    }

    return { ok: true, autoTranslate: enabled };
  },

  'home:quick-translate': async ({ msg }) => {
    try {
      // With <all_urls> host permission, inject/start without per-site prompts
      const tabs = await queryTabs({ active: true, currentWindow: true });
      const [activeTab] = tabs || [];
      if (activeTab && activeTab.id && activeTab.url && urlEligible(activeTab.url)) {
        await ensureInjectedAndStart(activeTab.id);
      }

      if (msg.opts && typeof msg.opts === 'object') {
        const result = await handleTranslate(msg.opts);
        return result || { ok: true };
      }
      return { ok: true };
    } catch (error) {
      logger.error('Fallback quick translate failed:', error);
      return { error: error?.message || 'Translation failed' };
    }
  },

  // Onboarding/API key validator. Accepts messages from extension pages.
  testTranslation: async ({ msg }) => {
    try {
      const { provider, apiKey, text, source, target } = msg || {};
      if (!apiKey || typeof apiKey !== 'string') return { success: false, error: 'Missing API key' };

      const result = await handleTranslate({
        provider,
        apiKey,
        text: text || 'Hello',
        source: source || 'en',
        target: target || 'es',
        stream: false,
        noProxy: true,
        debug: false,
      });

      if (result && !result.error && typeof result.text === 'string') {
        return { success: true, text: result.text, confidence: result.confidence || 0.9 };
      }
      return { success: false, error: result?.error || 'Unknown error' };
    } catch (error) {
      return { success: false, error: error?.message || 'Service not available' };
    }
  },

  'local-model:test': async ({ msg }) => {
    try {
      const sample = (msg && msg.text) || 'Hello from local model';
      const source = (msg && msg.source) || 'en';
      const target = (msg && msg.target) || 'es';
      const result = await handleTranslate({
        provider: LOCAL_PROVIDER_ID,
        text: sample,
        source,
        target,
        autoInit: true,
        noProxy: true,
        debug: false,
      });
      if (result && !result.error) {
        return { success: true, text: result.text, confidence: result.confidence || 0.9 };
      }
      return { success: false, error: result?.error || 'Local model unavailable' };
    } catch (error) {
      return { success: false, error: error?.message || 'Local model test failed' };
    }
  },

  'tm-get-all': async () => {
    const entries = self.qwenTM && self.qwenTM.getAll ? await self.qwenTM.getAll() : [];
    return { entries };
  },

  'tm-clear': async () => {
    if (self.qwenTM && self.qwenTM.clear) {
      self.qwenTM.clear();
    }
    return { ok: true };
  },

  'translation-status': async ({ msg, state }) => {
    if (msg.status && msg.status.summary) {
      const { tokens, requests } = msg.status.summary;
      if (self.qwenThrottle && self.qwenThrottle.recordUsage) {
        self.qwenThrottle.recordUsage(tokens, requests);
      }
      if (msg.status.summary.cache) {
        Object.assign(state.cache, msg.status.summary.cache);
      }
      if (msg.status.summary.tm) {
        Object.assign(state.tm, msg.status.summary.tm);
      }
      if (msg.status.active !== undefined) {
        state.status.active = msg.status.active;
      }
    }
    return { ok: true };
  },
};

if (commandDispatcher && typeof commandDispatcher.setFallbackHandlers === 'function') {
  commandDispatcher.setFallbackHandlers(fallbackHandlers, ensureTestState);
}

if (typeof self !== 'undefined') {
  try { self.fallbackHandlers = fallbackHandlers; } catch {}
  try { self.ensureTestState = ensureTestState; } catch {}
}

const routerFactory = self.qwenCommandRouter && self.qwenCommandRouter.createCommandRouter;
let commandRouter;
if (routerFactory) {
  commandRouter = routerFactory({
    commandDispatcher,
    errorHandler,
    validateBasicMessageSecurity,
    validateTranslationSecurity,
    messageRateLimit,
    fallbackHandlers,
    ensureTestState,
    logger,
  });
} else {
  logger.warn('commandRouter factory not available; using fallback router');
  commandRouter = (raw, sender, sendResponse) => {
    if (!raw || typeof raw !== 'object') {
      sendResponse({ error: 'Invalid request' });
      return true;
    }
    if (!raw.action && raw.type) raw.action = raw.type;
    if (!raw.action) {
      sendResponse({ error: 'Invalid request' });
      return true;
    }
    // Fast path for home:init when full command router is unavailable
    // Returns lightweight providers map from usage snapshot without hitting storage/providerStore
    if (raw.action === 'home:init') {
      const providersUsageSnapshot = buildProvidersUsageSnapshot();
      const usage = self.qwenThrottle ? self.qwenThrottle.getUsage() : {};
      const providers = {};
      Object.keys(providersUsageSnapshot || {}).forEach(id => {
        const u = providersUsageSnapshot[id] || {};
        providers[id] = {
          apiKey: false,
          model: '',
          endpoint: '',
          requests: u.requests || 0,
          tokens: u.tokens || 0,
          totalRequests: u.totalRequests || 0,
          totalTokens: u.totalTokens || 0,
        };
      });
      sendResponse({ providers, providersUsage: providersUsageSnapshot, usage, provider: 'qwen', apiKey: false });
      return true;
    }
    const handler = fallbackHandlers[raw.action];
    if (typeof handler !== 'function') {
      sendResponse({ error: 'Service not available' });
      return true;
    }
    Promise.resolve(handler({ msg: raw, sender, state: ensureTestState() }))
      .then(result => {
        if (result === undefined) {
          sendResponse({ ok: true });
        } else {
          sendResponse(result);
        }
      })
      .catch(error => {
        logger.error('Fallback router handler failed', error);
        sendResponse({ error: error?.message || 'Service not available' });
      });
    return true;
  };
}

chrome.runtime.onMessage.addListener(commandRouter);


// Helper function for quality verification
const applyQualityCheck = async (opts, result, storedKey, safeOpts) => {
  let confidence = scoreConfidence(opts.text, result && result.text);

  if (config.qualityVerify && self.qwenQualityCheck && self.qwenQualityCheck.verify) {
    try {
      const qc = await self.qwenQualityCheck.verify({
        text: opts.text,
        source: opts.source,
        target: opts.target,
        provider: safeOpts.provider,
        endpoint: safeOpts.endpoint,
        model: safeOpts.model,
        apiKey: storedKey,
        providerOrder: config.providerOrder,
        endpoints: opts.endpoints,
      });
      if (qc && typeof qc.score === 'number') {
        confidence = qc.score;
        lastQuality = confidence;
      } else {
        lastQuality = 0;
      }
    } catch (e) {
      logger.warn('quality check failed', e);
      lastQuality = 0;
    }
  } else {
    lastQuality = 0;
  }

  return confidence;
};

// Helper functions for port message translation
const setupPortTranslationRequest = (requestId, opts) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.translateTimeoutMs || TRANSLATE_TIMEOUT_MS);
  activeTranslations++;
  updateBadge();

  const ep = opts.endpoint && opts.endpoint.endsWith('/') ? opts.endpoint : (opts.endpoint ? `${opts.endpoint}/` : opts.endpoint);

  return { controller, timeout, ep };
};

const executePortTranslation = async (opts, safeOpts, requestId, port) => {
  let result;

  if (opts && opts.stream) {
    result = await self.qwenTranslateStream(safeOpts, chunk => {
      try { port.postMessage({ requestId, chunk }); } catch {}
    });
  } else {
    result = await self.qwenTranslate(safeOpts);
  }

  return result;
};

const handlePortTranslationError = (err, requestId, port) => {
  logger.error('background port translation error', err);
  iconError = true;

  const offline = isOfflineError(err);
  try { port.postMessage({ requestId, error: offline ? 'offline' : err.message }); } catch {}
  if (offline) {
    safeSendMessage({ action: 'translation-status', status: { offline: true } });
  }
};

const cleanupPortTranslation = (timeout, requestId) => {
  clearTimeout(timeout);
  inflight.delete(requestId);
  activeTranslations--;
  updateBadge();
  if (!__isTestEnv) broadcastStats();
};

// Port Message Action Handlers
const portMessageHandlers = {
  async translate(msg, port) {
    const { requestId, opts } = msg;
    if (!requestId || !opts) return;

    await ensureThrottle();
    const { controller, timeout, ep } = setupPortTranslationRequest(requestId, opts);

    const storedKey = await getApiKeyFromStorage();
    const safeOpts = { ...opts, endpoint: ep, apiKey: storedKey, signal: controller.signal, noProxy: true };
    const start = Date.now();
    const tokens = self.qwenThrottle.approxTokens(safeOpts.text || '');

    inflight.set(requestId, { controller, timeout, port });

    try {
      const result = await executePortTranslation(opts, safeOpts, requestId, port);
      const confidence = await applyQualityCheck(opts, result, storedKey, safeOpts);

      try { port.postMessage({ requestId, result: { ...result, confidence } }); } catch {}

      logUsage(tokens, Date.now() - start);
      iconError = false;
    } catch (err) {
      handlePortTranslationError(err, requestId, port);
      logUsage(tokens, Date.now() - start);
    } finally {
      cleanupPortTranslation(timeout, requestId);
    }
  },

  async detect(msg, port) {
    const { requestId, opts } = msg;
    if (!requestId || !opts) return;

    try {
      const sample = String(opts.text || '');
      let out;

      if (sample.replace(/\s+/g, '').length < (opts.minLength || 0)) {
        out = { lang: undefined, confidence: 0 };
      } else {
        out = opts.detector === 'google'
          ? await googleDetectLanguage(opts.text, opts.debug)
          : localDetectLanguage(opts.text, opts.minLength);
      }

      try { port.postMessage({ requestId, result: out }); } catch {}
    } catch (err) {
      try { port.postMessage({ requestId, error: err.message }); } catch {}
    }
  },

  cancel(msg, port) {
    if (!msg.requestId) return;

    const rec = inflight.get(msg.requestId);
    if (rec) {
      try { rec.controller.abort(); } catch {}
      clearTimeout(rec.timeout);
      inflight.delete(msg.requestId);
    }
  },
};

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'qwen-translate') return;

  port.onMessage.addListener(async (msg) => {
    if (!msg || typeof msg !== 'object') return;

    // Dispatch to appropriate handler
    const handler = portMessageHandlers[msg.action];
    if (handler) {
      try {
        await handler(msg, port);
      } catch (error) {
        logger.error(`Port handler error for action ${msg.action}:`, error);
        try {
          port.postMessage({
            requestId: msg.requestId,
            error: error.message || 'Handler failed',
          });
        } catch {}
      }
    }
  });

  port.onDisconnect.addListener(() => {
    for (const [id, rec] of inflight.entries()) {
      if (rec.port === port) {
        try { rec.controller.abort(); } catch {}
        clearTimeout(rec.timeout);
        inflight.delete(id);
      }
    }
  });
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' && tab && tab.url && tab.active) {
    maybeAutoInject(tabId, tab.url);
  }
});

if (chrome.tabs && chrome.tabs.onActivated) {
  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
      const tab = await new Promise(resolve => {
        chrome.tabs.get(tabId, t => {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(t);
        });
      });
      if (tab && tab.url && tab.status === 'complete') {
        maybeAutoInject(tabId, tab.url);
      }
    } catch {}
  });
}

function coerceNonNegative(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return num;
}

function sanitizeProviderEntry(entry = {}) {
  if (!entry || typeof entry !== 'object') return null;
  const sanitized = {
    apiKey: entry.apiKey === true,
    model: typeof entry.model === 'string' ? entry.model : '',
    endpoint: typeof entry.endpoint === 'string' ? entry.endpoint : '',
    requests: coerceNonNegative(entry.requests),
    tokens: coerceNonNegative(entry.tokens),
    totalRequests: coerceNonNegative(entry.totalRequests),
    totalTokens: coerceNonNegative(entry.totalTokens)
  };

  const meaningful = sanitized.apiKey || sanitized.model || sanitized.endpoint ||
    sanitized.requests > 0 || sanitized.tokens > 0 || sanitized.totalRequests > 0 || sanitized.totalTokens > 0;

  return meaningful ? sanitized : null;
}

function sanitizeProviders(providers = {}) {
  const result = {};
  if (!providers || typeof providers !== 'object') return result;

  for (const [id, entry] of Object.entries(providers)) {
    const sanitized = sanitizeProviderEntry(entry);
    if (sanitized) {
      result[id] = sanitized;
    }
  }
  return result;
}

function sanitizeProvidersUsage(providersUsage = {}) {
  const result = {};
  if (!providersUsage || typeof providersUsage !== 'object') return result;

  for (const [id, usage] of Object.entries(providersUsage)) {
    if (!usage || typeof usage !== 'object') continue;
    const sanitized = {
      requests: coerceNonNegative(usage.requests),
      tokens: coerceNonNegative(usage.tokens),
      totalRequests: coerceNonNegative(usage.totalRequests),
      totalTokens: coerceNonNegative(usage.totalTokens)
    };
    const meaningful = sanitized.requests > 0 || sanitized.tokens > 0 || sanitized.totalRequests > 0 || sanitized.totalTokens > 0;
    if (meaningful) {
      result[id] = sanitized;
    }
  }

  return result;
}

function _sanitizeHomeInitResponse(payload = {}) {
  let hadInvalid = false;

  const providers = sanitizeProviders(payload.providers);
  if (payload.providers && Object.keys(payload.providers).length !== Object.keys(providers).length) {
    hadInvalid = true;
  }

  const providersUsage = sanitizeProvidersUsage(payload.providersUsage);
  if (payload.providersUsage && Object.keys(payload.providersUsage).length !== Object.keys(providersUsage).length) {
    hadInvalid = true;
  }

  const usage = {
    requests: coerceNonNegative(payload.usage?.requests),
    tokens: coerceNonNegative(payload.usage?.tokens)
  };

  if (usage.requests !== (Number(payload.usage?.requests) || 0)) hadInvalid = true;
  if (usage.tokens !== (Number(payload.usage?.tokens) || 0)) hadInvalid = true;

  const requestLimit = coerceNonNegative(payload.usage?.requestLimit);
  if (requestLimit > 0) usage.requestLimit = requestLimit;
  if (requestLimit !== (Number(payload.usage?.requestLimit) || 0)) hadInvalid = true;

  const tokenLimit = coerceNonNegative(payload.usage?.tokenLimit);
  if (tokenLimit > 0) usage.tokenLimit = tokenLimit;
  if (tokenLimit !== (Number(payload.usage?.tokenLimit) || 0)) hadInvalid = true;

  const provider = typeof payload.provider === 'string' && payload.provider.trim()
    ? payload.provider.trim()
    : 'unknown';
  if (provider === 'unknown' && payload.provider !== undefined && payload.provider !== null && String(payload.provider).trim() !== '') {
    hadInvalid = true;
  }

  const apiKey = payload.apiKey === true;
  if (apiKey !== (payload.apiKey === true)) {
    hadInvalid = true;
  }

  const sanitized = {
    providers,
    providersUsage,
    usage,
    provider,
    apiKey
  };

  if (hadInvalid && logger && typeof logger.warn === 'function') {
    logger.warn('home:init payload sanitized', {
      provider,
      providersCount: Object.keys(providers).length,
      providersUsageCount: Object.keys(providersUsage).length
    });
  }

  return sanitized;
}

if (typeof module !== 'undefined') {
  module.exports = {
    updateBadge,
    setUsingPlus,
    _setActiveTranslations,
    handleTranslate,
    _setConfig,
    _sanitizeHomeInitResponse,
    // test helper to call fallback handlers in jest
    _test_call: async (action, payload) => {
      const h = fallbackHandlers[action];
      if (typeof h !== 'function') return null;
      return await h({ msg: payload || {}, state: ensureTestState() });
    },
  };
}
