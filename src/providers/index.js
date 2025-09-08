;(function () {
const root = typeof window !== 'undefined'
  ? window
  : typeof self !== 'undefined'
    ? self
    : globalThis;

const Providers = (typeof window !== 'undefined' && window.qwenProviders)
  || (typeof self !== 'undefined' && self.qwenProviders)
  || (typeof require !== 'undefined' ? require('../lib/providers') : null);

const baseInit = Providers && Providers.init ? Providers.init.bind(Providers) : () => {};
const baseIsInitialized = Providers && Providers.isInitialized ? Providers.isInitialized.bind(Providers) : () => false;
const baseReset = Providers && Providers.reset ? Providers.reset.bind(Providers) : () => {};
const baseRegister = Providers && Providers.register ? Providers.register.bind(Providers) : () => {};
const baseGet = Providers && Providers.get ? Providers.get.bind(Providers) : () => undefined;
const baseCandidates = Providers && Providers.candidates ? Providers.candidates.bind(Providers) : () => [];

// Lazy loading cache to avoid loading the same provider multiple times
const loadingCache = new Map();
const loadedProviders = new Set();

// Provider path mapping for on-demand loading
const providerPaths = {
  'deepl': './deepl',
  'deepl-free': './deepl',
  'deepl-pro': './deepl',
  'macos': './macos',
  'mistral': './mistral',
  'openai': './openai',
  'openrouter': './openrouter',
  'ollama': './ollama',
  'gemini': './gemini',
  'anthropic': './anthropic',
  'dashscope': './dashscope',
  'google': './google',
  'qwen': './qwen',
  'local-wasm': './localWasm'
};

function load(name, path) {
  if (root[name]) return root[name];
  if (typeof require !== 'undefined') {
    try { return require(path); } catch {}
  }
  return undefined;
}

// Lazy load a specific provider on-demand
async function loadProvider(name) {
  // Check if already loaded
  if (baseGet(name)) return baseGet(name);
  
  // Check if already loading (avoid concurrent loads)
  if (loadingCache.has(name)) {
    return loadingCache.get(name);
  }

  const path = providerPaths[name];
  if (!path) return null;

  const loadPromise = (async () => {
    try {
      // Handle provider variants that share the same module
      if (name.startsWith('deepl')) {
        const deepl = load('qwenProviderDeepL', path);
        if (deepl) {
          if (name === 'deepl' && !baseGet('deepl')) {
            registerProvider('deepl', deepl.basic);
            loadedProviders.add('deepl');
          }
          if (name === 'deepl-free' && !baseGet('deepl-free')) {
            registerProvider('deepl-free', deepl.free);
            loadedProviders.add('deepl-free');
          }
          if (name === 'deepl-pro' && !baseGet('deepl-pro')) {
            registerProvider('deepl-pro', deepl.pro);
            loadedProviders.add('deepl-pro');
          }
          return baseGet(name);
        }
      } else {
        // Single provider modules
        const provider = load(`qwenProvider${name.charAt(0).toUpperCase() + name.slice(1)}`, path);
        if (provider && !baseGet(name)) {
          const label = {
            'macos': 'macOS',
            'mistral': 'Mistral',
            'openai': 'OpenAI',
            'openrouter': 'OpenRouter',
            'ollama': 'Ollama',
            'gemini': 'Gemini',
            'anthropic': 'Anthropic',
            'dashscope': 'DashScope',
            'google': 'Google',
            'local-wasm': 'Local WASM'
          }[name] || name;
          
          registerProvider(name, provider.label ? provider : { ...provider, label });
          loadedProviders.add(name);
          return baseGet(name);
        }
      }
    } catch (e) {
      console.warn(`Failed to load provider ${name}:`, e);
    }
    return null;
  })();

  loadingCache.set(name, loadPromise);
  
  try {
    const result = await loadPromise;
    return result;
  } finally {
    loadingCache.delete(name);
  }
}

// Initialize core providers registry without loading all providers
function initProviders() {
  if (!Providers) return;
  baseInit();
  
  // Only load the default DashScope provider initially
  const dashscope = load('qwenProviderDashScope', './dashscope');
  if (dashscope && !baseGet('dashscope')) {
    registerProvider('dashscope', { ...dashscope, label: 'DashScope' });
    loadedProviders.add('dashscope');
  }
}

function isInitialized() {
  return baseIsInitialized();
}

function ensureProviders(loadAll = false) {
  const wasInitialized = isInitialized();
  
  if (!wasInitialized) {
    initProviders();
  }
  
  // If loadAll is requested (like in tests), load all providers
  if (loadAll && typeof require !== 'undefined') {
    const allProviderNames = Object.keys(providerPaths);
    for (const name of allProviderNames) {
      if (!baseGet(name)) {
        try {
          const path = providerPaths[name];
          // Synchronous loading for test compatibility
          if (name.startsWith('deepl')) {
            const deepl = load('qwenProviderDeepL', path);
            if (deepl) {
              if (name === 'deepl' && !baseGet('deepl')) registerProvider('deepl', deepl.basic);
              if (name === 'deepl-free' && !baseGet('deepl-free')) registerProvider('deepl-free', deepl.free);
              if (name === 'deepl-pro' && !baseGet('deepl-pro')) registerProvider('deepl-pro', deepl.pro);
            }
          } else {
            const provider = load(`qwenProvider${name.charAt(0).toUpperCase() + name.slice(1)}`, path);
            if (provider) {
              const labels = {
                'macos': 'macOS',
                'mistral': 'Mistral',
                'openai': 'OpenAI',
                'openrouter': 'OpenRouter',
                'ollama': 'Ollama',
                'gemini': 'Gemini',
                'anthropic': 'Anthropic',
                'dashscope': 'DashScope',
                'google': 'Google',
                'local-wasm': 'Local WASM'
              };
              const label = labels[name] || name;
              registerProvider(name, provider.label ? provider : { ...provider, label });
              loadedProviders.add(name);
            }
          }
        } catch (e) {
          console.warn(`Failed to load provider ${name}:`, e);
        }
      }
    }
  }
  
  // Return true if initialization happened (was not initialized), false if already initialized
  return !wasInitialized;
}

function resetProviders() {
  baseReset();
}

function registerProvider(name, provider) {
  if (name && provider) baseRegister(name, provider);
}

function getProvider(name) {
  const existing = baseGet(name);
  if (existing) return existing;
  
  // For synchronous calls, return undefined if not loaded
  return undefined;
}

// Async version that loads on-demand
async function getProviderAsync(name) {
  const existing = baseGet(name);
  if (existing) return existing;
  
  // Load provider on-demand
  return await loadProvider(name);
}

function listProviders() {
  // Show both loaded providers and available providers from path map
  const loaded = Array.from(baseCandidates({}));
  const available = Object.keys(providerPaths);
  const allProviders = new Set([...loaded, ...available]);
  
  return Array.from(allProviders).map(name => {
    const p = baseGet(name);
    if (p && p.label) {
      return { name, label: p.label };
    }
    
    // Return default labels for unloaded providers
    const defaultLabels = {
      'deepl': 'DeepL',
      'deepl-free': 'DeepL Free',
      'deepl-pro': 'DeepL Pro',
      'macos': 'macOS',
      'mistral': 'Mistral',
      'openai': 'OpenAI',
      'openrouter': 'OpenRouter',
      'ollama': 'Ollama',
      'gemini': 'Gemini',
      'anthropic': 'Anthropic',
      'dashscope': 'DashScope',
      'google': 'Google',
      'qwen': 'Qwen',
      'local-wasm': 'Local WASM'
    };
    
    return { name, label: defaultLabels[name] || name };
  });
}

const api = {
  registerProvider,
  getProvider,
  getProviderAsync,
  loadProvider,
  listProviders,
  initProviders,
  ensureProviders,
  isInitialized,
  resetProviders,
  getLoadedProviders: () => Array.from(loadedProviders),
};

if (typeof window !== 'undefined') {
  window.qwenProviders = Object.assign(Providers || {}, api);
} else if (typeof self !== 'undefined') {
  self.qwenProviders = Object.assign(Providers || {}, api);
}

if (typeof module !== 'undefined') module.exports = api;
})();

