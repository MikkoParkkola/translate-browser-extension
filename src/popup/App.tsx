import { createSignal, onMount, onCleanup, Show } from 'solid-js';
import { ProviderStatus } from './components/ProviderStatus';
import { ModelSelector, type ModelDownloadStatus } from './components/ModelSelector';
import { LanguageSelector } from './components/LanguageSelector';
import { StrategySelector } from './components/StrategySelector';
import { UsageBar } from './components/UsageBar';
import { CostMonitor } from './components/CostMonitor';
import { ModelStatus } from './components/ModelStatus';
import type { Strategy, UsageStats, ModelProgressMessage, TranslationProviderId } from '../types';
import { safeStorageGet, safeStorageSet } from '../core/storage';

// Detect browser's preferred language, fallback to 'en'
const getBrowserLanguage = () => {
  const lang = navigator.language?.split('-')[0] || 'en';
  return lang;
};

export default function App() {
  const [sourceLang, setSourceLangInternal] = createSignal('auto');
  const [targetLang, setTargetLangInternal] = createSignal(getBrowserLanguage());
  const [strategy, setStrategyInternal] = createSignal<Strategy>('smart');
  const [activeProvider, setActiveProvider] = createSignal<TranslationProviderId>('opus-mt');
  const [providerStatus, setProviderStatus] = createSignal<'ready' | 'loading' | 'error'>('ready');

  const providerName = () => {
    switch (activeProvider()) {
      case 'translategemma': return 'TranslateGemma 4B';
      case 'chrome-builtin': return 'Chrome Built-in';
      default: return 'Helsinki-NLP OPUS-MT';
    }
  };
  const [isTranslating, setIsTranslating] = createSignal(false);
  const [autoTranslate, setAutoTranslate] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [usage, _setUsage] = createSignal<UsageStats>({
    today: { requests: 0, characters: 0, cost: 0 },
    budget: { monthly: 2.0, used: 0 },
  });

  // Model caching state
  const [isModelLoading, setIsModelLoading] = createSignal(false);
  const [modelProgress, setModelProgress] = createSignal(0);
  const [isModelCached, setIsModelCached] = createSignal(false);
  const [currentModelId, setCurrentModelId] = createSignal<string | null>(null);
  const [downloadingFile, setDownloadingFile] = createSignal<string | null>(null);

  // Per-model download status for ModelSelector
  // Cloud providers and chrome-builtin don't need downloads - always "ready"
  const [modelDownloadStatus, setModelDownloadStatus] = createSignal<
    Record<TranslationProviderId, ModelDownloadStatus>
  >({
    'opus-mt': { isDownloading: false, progress: 0, isDownloaded: false, error: null },
    'translategemma': { isDownloading: false, progress: 0, isDownloaded: false, error: null },
    'chrome-builtin': { isDownloading: false, progress: 100, isDownloaded: true, error: null },
    'deepl': { isDownloading: false, progress: 100, isDownloaded: true, error: null },
    'openai': { isDownloading: false, progress: 100, isDownloaded: true, error: null },
    'google-cloud': { isDownloading: false, progress: 100, isDownloaded: true, error: null },
    'anthropic': { isDownloading: false, progress: 100, isDownloaded: true, error: null },
  });

  // Wrapper functions that persist language preferences to storage
  const setSourceLang = (lang: string) => {
    setSourceLangInternal(lang);
    safeStorageSet({ sourceLang: lang });
  };

  const setTargetLang = (lang: string) => {
    setTargetLangInternal(lang);
    safeStorageSet({ targetLang: lang });
    console.log('[Popup] Target language saved:', lang);
  };

  const setStrategy = (s: Strategy) => {
    setStrategyInternal(s);
    safeStorageSet({ strategy: s });
  };

  // Determine provider from model ID (e.g., "Xenova/opus-mt-en-fi" -> "opus-mt")
  const getProviderFromModelId = (modelId: string): TranslationProviderId | null => {
    if (modelId.includes('opus-mt')) return 'opus-mt';
    if (modelId.includes('gemma') || modelId.includes('translategemma')) return 'translategemma';
    return null;
  };

  // Update per-model download status
  const updateModelStatus = (
    providerId: TranslationProviderId,
    updates: Partial<ModelDownloadStatus>
  ) => {
    setModelDownloadStatus((prev) => ({
      ...prev,
      [providerId]: { ...prev[providerId], ...updates },
    }));
  };

  // Handle model progress messages from offscreen document
  const handleModelProgress = (message: ModelProgressMessage) => {
    if (message.type !== 'modelProgress') return;

    console.log('[Popup] Model progress:', message.status, message.progress);
    setCurrentModelId(message.modelId);

    // Determine which provider this model belongs to
    const providerId = getProviderFromModelId(message.modelId);

    switch (message.status) {
      case 'initiate':
        setIsModelLoading(true);
        setIsModelCached(false);
        setModelProgress(0);
        setProviderStatus('loading');
        setDownloadingFile(message.file || null);
        if (providerId) {
          updateModelStatus(providerId, {
            isDownloading: true,
            progress: 0,
            isDownloaded: false,
            error: null,
          });
        }
        break;
      case 'download':
      case 'progress':
        setIsModelLoading(true);
        setModelProgress(message.progress ?? 0);
        setDownloadingFile(message.file || null);
        if (providerId) {
          updateModelStatus(providerId, {
            isDownloading: true,
            progress: message.progress ?? 0,
          });
        }
        break;
      case 'done':
        setModelProgress(100);
        setDownloadingFile(null);
        if (providerId) {
          updateModelStatus(providerId, {
            progress: 100,
          });
        }
        break;
      case 'ready':
        setIsModelLoading(false);
        setIsModelCached(true);
        setModelProgress(100);
        setProviderStatus('ready');
        setDownloadingFile(null);
        if (providerId) {
          updateModelStatus(providerId, {
            isDownloading: false,
            progress: 100,
            isDownloaded: true,
            error: null,
          });
        }
        break;
      case 'error':
        setIsModelLoading(false);
        setProviderStatus('error');
        setDownloadingFile(null);
        if (message.error) {
          setError(`Model error: ${message.error}`);
        }
        if (providerId) {
          updateModelStatus(providerId, {
            isDownloading: false,
            error: message.error || 'Unknown error',
          });
        }
        break;
    }
  };

  onMount(async () => {
    // Listen for model progress messages
    const messageListener = (message: ModelProgressMessage) => {
      handleModelProgress(message);
    };
    chrome.runtime.onMessage.addListener(messageListener);

    // Store cleanup function
    onCleanup(() => {
      chrome.runtime.onMessage.removeListener(messageListener);
    });

    // Load saved preferences (use internal setters to avoid re-saving)
    interface StoredPrefs {
      sourceLang?: string;
      targetLang?: string;
      strategy?: Strategy;
      autoTranslate?: boolean;
      provider?: TranslationProviderId;
    }
    const stored = await safeStorageGet<StoredPrefs>(['sourceLang', 'targetLang', 'strategy', 'autoTranslate', 'provider']);
    if (stored.sourceLang) setSourceLangInternal(stored.sourceLang);
    if (stored.targetLang) setTargetLangInternal(stored.targetLang);
    if (stored.strategy) setStrategyInternal(stored.strategy);
    if (stored.autoTranslate !== undefined) setAutoTranslate(stored.autoTranslate);
    if (stored.provider) setActiveProvider(stored.provider);
    console.log('[Popup] Loaded preferences:', { source: stored.sourceLang, target: stored.targetLang });

    // Check Chrome Translator API availability (Chrome 138+)
    try {
      const response = await chrome.runtime.sendMessage({ type: 'checkChromeTranslator' });
      if (response?.available) {
        console.log('[Popup] Chrome Translator API available');
        updateModelStatus('chrome-builtin', { isDownloaded: true, error: null });
      } else {
        console.log('[Popup] Chrome Translator API not available (Chrome 138+ required)');
        updateModelStatus('chrome-builtin', { isDownloaded: false, error: 'Chrome 138+ required' });
      }
    } catch (e) {
      console.log('[Popup] Chrome Translator check failed:', e);
      updateModelStatus('chrome-builtin', { isDownloaded: false, error: 'Not available' });
    }
  });

  const toggleAutoTranslate = async () => {
    const newValue = !autoTranslate();
    setAutoTranslate(newValue);
    const saved = await safeStorageSet({
      autoTranslate: newValue,
      sourceLang: sourceLang(),
      targetLang: targetLang(),
      strategy: strategy(),
    });
    if (saved) {
      console.log('[Popup] Auto-translate:', newValue);
    }
  };

  const handleProviderChange = async (provider: TranslationProviderId) => {
    setActiveProvider(provider);
    setProviderStatus('ready');
    setError(null);

    await safeStorageSet({ provider });
    try {
      // Notify background service worker
      await chrome.runtime.sendMessage({ type: 'setProvider', provider });
      console.log('[Popup] Provider changed to:', provider);
    } catch (e) {
      console.error('[Popup] Failed to set provider:', e);
    }
  };

  // Inject content script if not already loaded
  const ensureContentScript = async (tabId: number): Promise<boolean> => {
    try {
      // Try to ping the content script
      await chrome.tabs.sendMessage(tabId, { type: 'ping' });
      return true;
    } catch {
      // Content script not loaded, inject it
      console.log('[Popup] Injecting content script...');
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js'],
        });
        // Wait a bit for script to initialize
        await new Promise((resolve) => setTimeout(resolve, 100));
        return true;
      } catch (injectError) {
        console.error('[Popup] Failed to inject content script:', injectError);
        return false;
      }
    }
  };

  const handleError = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('Cannot access')) {
      setError('Cannot translate this page');
    } else {
      setError(msg);
    }
    // Clear error after 5 seconds
    setTimeout(() => setError(null), 5000);
  };

  const handleTranslateSelection = async () => {
    setIsTranslating(true);
    setError(null);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        setError('No active tab');
        return;
      }
      // Check if it's a restricted URL
      if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('about:') || tab.url?.startsWith('chrome-extension://')) {
        setError('Cannot translate browser pages');
        return;
      }
      // Ensure content script is loaded
      const injected = await ensureContentScript(tab.id);
      if (!injected) {
        setError('Cannot access this page');
        return;
      }
      await chrome.tabs.sendMessage(tab.id, {
        type: 'translateSelection',
        sourceLang: sourceLang(),
        targetLang: targetLang(),
        strategy: strategy(),
        provider: activeProvider(),
      });
    } catch (e) {
      console.error('[Popup] Translation failed:', e);
      handleError(e);
    } finally {
      setIsTranslating(false);
    }
  };

  const handleTranslatePage = async () => {
    setIsTranslating(true);
    setError(null);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        setError('No active tab');
        return;
      }
      if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('about:') || tab.url?.startsWith('chrome-extension://')) {
        setError('Cannot translate browser pages');
        return;
      }
      // Ensure content script is loaded
      const injected = await ensureContentScript(tab.id);
      if (!injected) {
        setError('Cannot access this page');
        return;
      }
      await chrome.tabs.sendMessage(tab.id, {
        type: 'translatePage',
        sourceLang: sourceLang(),
        targetLang: targetLang(),
        strategy: strategy(),
        provider: activeProvider(),
      });
    } catch (e) {
      console.error('[Popup] Page translation failed:', e);
      handleError(e);
    } finally {
      setIsTranslating(false);
    }
  };

  const swapLanguages = () => {
    if (sourceLang() !== 'auto') {
      const temp = sourceLang();
      setSourceLang(targetLang());
      setTargetLang(temp);
    }
  };

  const openSettings = () => {
    chrome.runtime.openOptionsPage();
  };

  return (
    <div class="popup-container">
      {/* Header */}
      <header class="popup-header">
        <div class="header-brand">
          <div class="brand-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M3 5h12M9 3v2m1.048 3.5A3.5 3.5 0 016.5 12a3.5 3.5 0 01-2.45-5.943M6 16l-2 6 3-2 3 2-2-6M21 21l-6-6m6 0l-6 6M15 15l6-6m-6 0l6 6"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </div>
          <div class="brand-text">
            <h1 class="brand-title">TRANSLATE!</h1>
            <span class="brand-author">by Mikko</span>
          </div>
          <button class="settings-button" onClick={openSettings} aria-label="Settings">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" />
              <path
                d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"
                stroke="currentColor"
                stroke-width="2"
              />
            </svg>
          </button>
        </div>
        <ProviderStatus name={providerName()} status={providerStatus()} />
        <ModelStatus
          isLoading={isModelLoading()}
          progress={modelProgress()}
          isCached={isModelCached()}
          modelId={currentModelId()}
          currentFile={downloadingFile()}
        />
      </header>

      <main class="popup-main">
        {/* Model Selection with Download Status */}
        <ModelSelector
          selected={activeProvider()}
          onChange={handleProviderChange}
          downloadStatus={modelDownloadStatus()}
        />

        {/* Language Selection */}
        <LanguageSelector
          sourceLang={sourceLang()}
          targetLang={targetLang()}
          onSourceChange={setSourceLang}
          onTargetChange={setTargetLang}
          onSwap={swapLanguages}
        />

        {/* Strategy Selection */}
        <StrategySelector selected={strategy()} onChange={setStrategy} />

        {/* Auto-Translate Toggle */}
        <section class="auto-section">
          <label class="auto-toggle">
            <input
              type="checkbox"
              checked={autoTranslate()}
              onChange={toggleAutoTranslate}
            />
            <span class="toggle-slider"></span>
            <span class="toggle-label">Auto-translate pages</span>
          </label>
        </section>

        {/* Error Display */}
        <Show when={error()}>
          <div class="error-banner">{error()}</div>
        </Show>

        {/* Action Buttons */}
        <section class="action-section">
          <button
            class="action-button action-button--primary"
            onClick={handleTranslatePage}
            disabled={isTranslating()}
          >
            <Show when={!isTranslating()} fallback={<span class="spinner" />}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M4 6h16M4 10h16M4 14h16M4 18h16" stroke="currentColor" stroke-width="2" />
              </svg>
            </Show>
            <span>Translate Page</span>
          </button>

          <button
            class="action-button action-button--secondary"
            onClick={handleTranslateSelection}
            disabled={isTranslating()}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2l3.09 6.26L22 9l-5 4.87L18.18 22 12 18.77 5.82 22 7 13.87 2 9l6.91-.74L12 2z"
                stroke="currentColor"
                stroke-width="2"
                fill="none"
              />
            </svg>
            <span>Translate Selection</span>
          </button>
        </section>

        {/* Usage Tracking */}
        <UsageBar usage={usage()} />

        {/* Cost Monitor */}
        <CostMonitor usage={usage()} />
      </main>
    </div>
  );
}
