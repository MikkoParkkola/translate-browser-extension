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

function load(name, path) {
  if (root[name]) return root[name];
  if (typeof require !== 'undefined') {
    try { return require(path); } catch {}
  }
  return undefined;
}

function initProviders() {
  if (!Providers) return;
  baseInit();

  const deepl = load('qwenProviderDeepL', './deepl');
  if (deepl) {
    if (!baseGet('deepl')) registerProvider('deepl', deepl.basic);
    if (!baseGet('deepl-free')) registerProvider('deepl-free', deepl.free);
    if (!baseGet('deepl-pro')) registerProvider('deepl-pro', deepl.pro);
  }

  const macos = load('qwenProviderMacos', './macos');
  const existingMac = baseGet('macos');
  if (macos && (!existingMac || existingMac === macos)) {
    registerProvider('macos', { ...macos, label: 'macOS' });
  }

  const mistral = load('qwenProviderMistral', './mistral');
  const existingMistral = baseGet('mistral');
  if (mistral && (!existingMistral || existingMistral === mistral)) {
    registerProvider('mistral', { ...mistral, label: 'Mistral' });
  }

  const openai = load('qwenProviderOpenAI', './openai');
  const existingOpenAI = baseGet('openai');
  if (openai && (!existingOpenAI || existingOpenAI === openai)) {
    registerProvider('openai', { ...openai, label: 'OpenAI' });
  }

  const openrouter = load('qwenProviderOpenRouter', './openrouter');
  const existingOpenRouter = baseGet('openrouter');
  if (openrouter && (!existingOpenRouter || existingOpenRouter === openrouter)) {
    registerProvider('openrouter', { ...openrouter, label: 'OpenRouter' });
  }

  const ollama = load('qwenProviderOllama', './ollama');
  const existingOllama = baseGet('ollama');
  if (ollama && (!existingOllama || existingOllama === ollama)) {
    registerProvider('ollama', { ...ollama, label: 'Ollama' });
  }

  const gemini = load('qwenProviderGemini', './gemini');
  const existingGemini = baseGet('gemini');
  if (gemini && (!existingGemini || existingGemini === gemini)) {
    registerProvider('gemini', { ...gemini, label: 'Gemini' });
  }

  const anthropic = load('qwenProviderAnthropic', './anthropic');
  const existingAnthropic = baseGet('anthropic');
  if (anthropic && (!existingAnthropic || existingAnthropic === anthropic)) {
    registerProvider('anthropic', { ...anthropic, label: 'Anthropic' });
  }

  const dashscope = load('qwenProviderDashScope', './dashscope');
  const existingDash = baseGet('dashscope');
  if (dashscope && (!existingDash || existingDash === dashscope)) {
    registerProvider('dashscope', { ...dashscope, label: 'DashScope' });
  }

  const google = load('qwenProviderGoogle', './google');
  if (google && !baseGet('google')) registerProvider('google', { ...google, label: 'Google' });

  const qwen = load('qwenProviderQwen', './qwen');
  if (qwen && !baseGet('qwen')) registerProvider('qwen', qwen);

  const wasm = load('qwenProviderLocalWasm', './localWasm');
  if (wasm && !baseGet('local-wasm')) registerProvider('local-wasm', { ...wasm, label: 'Local WASM' });
}

function isInitialized() {
  return baseIsInitialized();
}

function ensureProviders() {
  if (!isInitialized()) {
    initProviders();
    return true;
  }
  return false;
}

function resetProviders() {
  baseReset();
}

function registerProvider(name, provider) {
  if (name && provider) baseRegister(name, provider);
}

function getProvider(name) {
  return baseGet(name);
}

function listProviders() {
  return Array.from(baseCandidates({})).map(name => {
    const p = baseGet(name) || {};
    return { name, label: p.label || name };
  });
}

const api = {
  registerProvider,
  getProvider,
  listProviders,
  initProviders,
  ensureProviders,
  isInitialized,
  resetProviders,
};

if (typeof window !== 'undefined') {
  window.qwenProviders = Object.assign(Providers || {}, api);
} else if (typeof self !== 'undefined') {
  self.qwenProviders = Object.assign(Providers || {}, api);
}

if (typeof module !== 'undefined') module.exports = api;
})();

