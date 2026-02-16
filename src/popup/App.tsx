import { createSignal, onMount, onCleanup, Show } from 'solid-js';
import { ProviderStatus } from './components/ProviderStatus';
import { ModelSelector, type ModelDownloadStatus } from './components/ModelSelector';
import { LanguageSelector } from './components/LanguageSelector';
import { StrategySelector } from './components/StrategySelector';
import { ModelStatus } from './components/ModelStatus';
import type { Strategy, ModelProgressMessage, TranslationProviderId } from '../types';
import { safeStorageGet, safeStorageSet } from '../core/storage';
import { browserAPI } from '../core/browser-api';
import { checkVersion, dismissUpdateNotice, isUpdateDismissed } from '../core/version';

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
  const [bilingualMode, setBilingualMode] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [errorAction, setErrorAction] = createSignal<{ label: string; handler: () => void } | null>(null);
  const [showUpdateBadge, setShowUpdateBadge] = createSignal(false);
  const [updateVersion, setUpdateVersion] = createSignal<string | null>(null);

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
    // Listen for model progress messages (with error boundary to prevent popup crash)
    const messageListener = (message: ModelProgressMessage) => {
      try {
        handleModelProgress(message);
      } catch (error) {
        console.error('[Popup] Error handling model progress message:', error);
      }
    };
    browserAPI.runtime.onMessage.addListener(messageListener);

    // Store cleanup function
    onCleanup(() => {
      browserAPI.runtime.onMessage.removeListener(messageListener);
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
      const response = await browserAPI.runtime.sendMessage({ type: 'checkChromeTranslator' });
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

    // Check for version update
    try {
      const versionInfo = await checkVersion();
      if (versionInfo.isUpdate) {
        const dismissed = await isUpdateDismissed();
        if (!dismissed) {
          setShowUpdateBadge(true);
          setUpdateVersion(versionInfo.current);
        }
      }
    } catch {
      // Version check is non-critical
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
      await browserAPI.runtime.sendMessage({ type: 'setProvider', provider });
      console.log('[Popup] Provider changed to:', provider);
    } catch (e) {
      console.error('[Popup] Failed to set provider:', e);
    }
  };

  // Inject content script if not already loaded
  const ensureContentScript = async (tabId: number): Promise<boolean> => {
    try {
      // Try to ping the content script
      await browserAPI.tabs.sendMessage(tabId, { type: 'ping' });
      return true;
    } catch {
      // Content script not loaded, inject it
      console.log('[Popup] Injecting content script...');
      try {
        await browserAPI.scripting.executeScript({
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

  const handleToggleBilingual = async () => {
    try {
      const [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      // Ensure content script is loaded
      const injected = await ensureContentScript(tab.id);
      if (!injected) {
        setError('Cannot access this page');
        return;
      }

      const response = await browserAPI.tabs.sendMessage(tab.id, { type: 'toggleBilingualMode' }) as { enabled: boolean } | undefined;
      if (response) {
        setBilingualMode(response.enabled);
        console.log('[Popup] Bilingual mode:', response.enabled);
      }
    } catch (e) {
      console.error('[Popup] Toggle bilingual mode failed:', e);
    }
  };

  const clearError = () => {
    setError(null);
    setErrorAction(null);
  };

  const handleError = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    const msgLower = msg.toLowerCase();

    // Reset action
    setErrorAction(null);

    if (msg.includes('Cannot access')) {
      setError('Cannot translate this page. Browser internal pages cannot be translated.');
    } else if (msgLower.includes('not configured') || msgLower.includes('api key')) {
      setError(`${msg}`);
      setErrorAction({ label: 'Open Settings', handler: () => { clearError(); openSettings(); } });
    } else if (msgLower.includes('no network') || msgLower.includes('offline')) {
      setError('No network connection. Switch to a local model for offline translation.');
      setErrorAction({ label: 'Use OPUS-MT', handler: () => { clearError(); handleProviderChange('opus-mt'); } });
    } else if (msgLower.includes('language pair') || msgLower.includes('not available') || msgLower.includes('unsupported')) {
      setError(msg);
    } else if (msgLower.includes('network') || msgLower.includes('connection') || (msgLower.includes('fetch') && !msgLower.includes('model'))) {
      setError(`Connection error. Check your internet connection.`);
      setErrorAction({ label: 'Retry', handler: () => { clearError(); handleTranslatePage(); } });
    } else if (msgLower.includes('rate') && msgLower.includes('limit')) {
      setError(`Rate limited. Please wait a moment before retrying.`);
      setErrorAction({ label: 'Retry', handler: () => { clearError(); handleTranslatePage(); } });
    } else if (msgLower.includes('timeout') || msgLower.includes('timed out')) {
      setError(`${msg}. Try with less text or wait for the model to fully load.`);
      setErrorAction({ label: 'Retry', handler: () => { clearError(); handleTranslatePage(); } });
    } else if (msgLower.includes('model') || msgLower.includes('pipeline') || msgLower.includes('load')) {
      setError(`${msg}. Try waiting for the model to download.`);
      setErrorAction({ label: 'Switch Provider', handler: () => { clearError(); handleProviderChange('chrome-builtin'); } });
    } else if (msgLower.includes('memory') || msgLower.includes('oom')) {
      setError(`${msg}. Try closing other tabs or using a smaller text selection.`);
    } else {
      setError(msg || 'Translation failed. Please try again.');
      setErrorAction({ label: 'Retry', handler: () => { clearError(); handleTranslatePage(); } });
    }
    // Clear error after 12 seconds (longer for action buttons)
    setTimeout(() => clearError(), 12000);
  };

  const handleTranslateSelection = async () => {
    setIsTranslating(true);
    setError(null);
    try {
      const [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        setError('No active tab');
        return;
      }
      // Check if it's a restricted URL (handles both Chrome and Firefox)
      const restrictedPrefixes = [
        'chrome://', 'about:', 'chrome-extension://',
        'moz-extension://', 'resource://', 'view-source:'
      ];
      if (tab.url && restrictedPrefixes.some(prefix => tab.url!.startsWith(prefix))) {
        setError('Cannot translate browser pages');
        return;
      }
      // Ensure content script is loaded
      const injected = await ensureContentScript(tab.id);
      if (!injected) {
        setError('Cannot access this page');
        return;
      }
      const response = await browserAPI.tabs.sendMessage(tab.id, {
        type: 'translateSelection',
        sourceLang: sourceLang(),
        targetLang: targetLang(),
        strategy: strategy(),
        provider: activeProvider(),
      });
      // Check for structured error response from content script
      if (response && typeof response === 'object' && 'success' in response && !response.success) {
        handleError(new Error(response.error || 'Translation failed'));
      }
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
      const [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        setError('No active tab');
        return;
      }
      // Check if it's a restricted URL (handles both Chrome and Firefox)
      const restrictedPrefixes = [
        'chrome://', 'about:', 'chrome-extension://',
        'moz-extension://', 'resource://', 'view-source:'
      ];
      if (tab.url && restrictedPrefixes.some(prefix => tab.url!.startsWith(prefix))) {
        setError('Cannot translate browser pages');
        return;
      }
      // Ensure content script is loaded
      const injected = await ensureContentScript(tab.id);
      if (!injected) {
        setError('Cannot access this page');
        return;
      }
      const response = await browserAPI.tabs.sendMessage(tab.id, {
        type: 'translatePage',
        sourceLang: sourceLang(),
        targetLang: targetLang(),
        strategy: strategy(),
        provider: activeProvider(),
      });
      // Check for structured error response from content script
      if (response && typeof response === 'object' && 'success' in response && !response.success) {
        handleError(new Error(response.error || 'Page translation failed'));
      }
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

  const handleUndo = async () => {
    try {
      const [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      const injected = await ensureContentScript(tab.id);
      if (!injected) return;

      await browserAPI.tabs.sendMessage(tab.id, { type: 'undoTranslation' });
    } catch (e) {
      console.error('[Popup] Undo failed:', e);
    }
  };

  const openSettings = () => {
    browserAPI.runtime.openOptionsPage();
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
            <h1 class="brand-title">
              TRANSLATE!
              <Show when={showUpdateBadge()}>
                <span
                  class="update-badge"
                  role="status"
                  aria-label={`Updated to v${updateVersion()}`}
                  onClick={() => { setShowUpdateBadge(false); dismissUpdateNotice(); }}
                  title={`Updated to v${updateVersion()}. Click to dismiss.`}
                >
                  v{updateVersion()}
                </span>
              </Show>
            </h1>
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

      <main class="popup-main" aria-label="Translation controls">
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
        <section class="auto-section" aria-label="Translation options">
          <label class="auto-toggle">
            <input
              type="checkbox"
              checked={autoTranslate()}
              onChange={toggleAutoTranslate}
              aria-label="Auto-translate pages"
            />
            <span class="toggle-slider" aria-hidden="true"></span>
            <span class="toggle-label">Auto-translate pages</span>
          </label>
          <label class="auto-toggle">
            <input
              type="checkbox"
              checked={bilingualMode()}
              onChange={handleToggleBilingual}
              aria-label="Bilingual mode"
            />
            <span class="toggle-slider" aria-hidden="true"></span>
            <span class="toggle-label">Bilingual mode</span>
          </label>
        </section>

        {/* Error Display */}
        <Show when={error()}>
          <div class="error-banner" role="alert" aria-live="assertive">
            <svg class="error-banner__icon" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
              <line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <circle cx="12" cy="16" r="1" fill="currentColor"/>
            </svg>
            <div class="error-banner__content">
              <div class="error-banner__message">{error()}</div>
              <Show when={errorAction()}>
                <button
                  class="error-banner__action"
                  onClick={() => errorAction()?.handler()}
                  aria-label={errorAction()?.label}
                >
                  {errorAction()?.label}
                </button>
              </Show>
            </div>
            <button
              class="error-banner__dismiss"
              onClick={() => clearError()}
              aria-label="Dismiss error"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
        </Show>

        {/* Action Buttons - Compact */}
        <section class="action-bar" aria-label="Translation actions">
          <button
            class="action-btn action-btn--primary"
            onClick={handleTranslatePage}
            disabled={isTranslating()}
            title="Translate entire page"
            aria-label={isTranslating() ? 'Translating page...' : 'Translate entire page'}
          >
            <Show when={!isTranslating()} fallback={<span class="spinner-small" />}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M3 5h12M9 3v2m1.048 3.5A3.5 3.5 0 016.5 12a3.5 3.5 0 01-2.45-5.943M6 16l-2 6 3-2 3 2-2-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </Show>
            <span>Page</span>
          </button>

          <button
            class="action-btn action-btn--secondary"
            onClick={handleTranslateSelection}
            disabled={isTranslating()}
            title="Translate selected text"
            aria-label="Translate selected text"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M4 7V4h16v3M9 20h6M12 4v16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>Selection</span>
          </button>

          <button
            class="action-btn action-btn--tertiary"
            onClick={handleUndo}
            title="Undo translation"
            aria-label="Undo translation"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M3 7v6h6M3 13a9 9 0 1018 0 9 9 0 00-15-6.7L3 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>Undo</span>
          </button>
        </section>
      </main>
    </div>
  );
}
