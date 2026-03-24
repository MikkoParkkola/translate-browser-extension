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
import { createLogger } from '../core/logger';
import { sleep } from '../core/async-utils';
import { extractErrorMessage } from '../core/errors';
import { sendBackgroundMessage, trySendBackgroundMessage } from '../shared/background-message';
import {
  PROVIDER_STATUS_NAMES,
  normalizeTranslationProviderId,
} from '../shared/provider-options';

const log = createLogger('Popup');

// Detect browser's preferred language, fallback to 'en'
const getBrowserLanguage = () => {
  /* v8 ignore start */
  const lang = navigator.language?.split('-')[0] || 'en';
  /* v8 ignore stop */
  return lang;
};

type TranslationCommand = 'translatePage' | 'translateSelection';

const BROWSER_INTERNAL_PREFIXES = [
  'chrome://',
  'about:',
  'chrome-extension://',
  'moz-extension://',
  'resource://',
  'view-source:',
] as const;

const isRestrictedTabUrl = (url?: string): boolean =>
  Boolean(url && BROWSER_INTERNAL_PREFIXES.some((prefix) => url.startsWith(prefix)));

export default function App() {
  const [sourceLang, setSourceLangInternal] = createSignal('auto');
  const [targetLang, setTargetLangInternal] = createSignal(getBrowserLanguage());
  const [strategy, setStrategyInternal] = createSignal<Strategy>('smart');
  const [activeProvider, setActiveProvider] = createSignal<TranslationProviderId>('opus-mt');
  const [providerStatus, setProviderStatus] = createSignal<'ready' | 'loading' | 'error'>('ready');

  const providerName = () => PROVIDER_STATUS_NAMES[activeProvider()] ?? activeProvider();
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

  // TranslateGemma requires hardware acceleration via WebGPU or WebNN.
  const [translateGemmaAvailable, setTranslateGemmaAvailable] = createSignal<boolean | null>(null);

  // Per-model readiness for ModelSelector.
  // Cloud providers are request-ready immediately; chrome-builtin becomes ready
  // only after the runtime capability probe succeeds.
  const [modelDownloadStatus, setModelDownloadStatus] = createSignal<
    Record<TranslationProviderId, ModelDownloadStatus>
  >({
    'opus-mt': { isDownloading: false, progress: 0, isDownloaded: false, error: null },
    'translategemma': { isDownloading: false, progress: 0, isDownloaded: false, error: null },
    'chrome-builtin': { isDownloading: false, progress: 0, isDownloaded: false, error: null },
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
    log.info('Target language saved:', lang);
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

    log.info('Model progress:', message.status, message.progress);
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
        log.error('Error handling model progress message:', error);
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
      provider?: unknown;
    }
    const stored = await safeStorageGet<StoredPrefs>(['sourceLang', 'targetLang', 'strategy', 'autoTranslate', 'provider']);
    if (stored.sourceLang) setSourceLangInternal(stored.sourceLang);
    if (stored.targetLang) setTargetLangInternal(stored.targetLang);
    if (stored.strategy) setStrategyInternal(stored.strategy);
    if (stored.autoTranslate !== undefined) setAutoTranslate(stored.autoTranslate);
    if (stored.provider !== undefined) {
      setActiveProvider(normalizeTranslationProviderId(stored.provider));
    }
    log.info('Loaded preferences:', { source: stored.sourceLang, target: stored.targetLang });

    // Check Chrome Translator API availability (Chrome 138+)
    const response = await trySendBackgroundMessage(
      { type: 'checkChromeTranslator' },
      {
        onError: (error) => {
          log.info('Chrome Translator check failed:', error);
          updateModelStatus('chrome-builtin', { isDownloaded: false, error: 'Not available' });
        },
      }
    );
    if (response?.available) {
      log.info('Chrome Translator API available');
      updateModelStatus('chrome-builtin', { isDownloaded: true, error: null });
    } else if (response) {
      log.info('Chrome Translator API not available (Chrome 138+ required)');
      updateModelStatus('chrome-builtin', { isDownloaded: false, error: 'Chrome 138+ required' });
    }

    // Check TranslateGemma hardware acceleration availability.
    // The model needs WebGPU or WebNN; it cannot run on the plain WASM heap.
    {
      const [gpuResponse, webnnResponse] = await Promise.all([
        trySendBackgroundMessage(
          { type: 'checkWebGPU' },
          {
            onError: (error) => {
              log.info('WebGPU check failed:', error);
            },
          }
        ),
        trySendBackgroundMessage(
          { type: 'checkWebNN' },
          {
            onError: (error) => {
              log.info('WebNN check failed:', error);
            },
          }
        ),
      ]);
      const hasWebGpu = gpuResponse?.supported === true;
      const hasWebNN = webnnResponse?.supported === true;
      const available = hasWebGpu || hasWebNN;
      setTranslateGemmaAvailable(available);
      log.info('TranslateGemma acceleration:', {
        webGpu: hasWebGpu,
        webGpuFp16: gpuResponse?.fp16 === true,
        webnn: hasWebNN,
      });

      if (!available) {
        updateModelStatus('translategemma', {
          isDownloaded: false,
          error: 'Requires WebGPU or WebNN (hardware acceleration not available)',
        });
        // Auto-switch away from TranslateGemma if it was saved from a previous session
        if (activeProvider() === 'translategemma') {
          log.info('TranslateGemma acceleration unavailable, switching to OPUS-MT');
          handleProviderChange('opus-mt');
          setError('TranslateGemma requires WebGPU or WebNN. Switched to OPUS-MT.');
          setTimeout(() => clearError(), 8000);
        }
      } else {
        updateModelStatus('translategemma', {
          error: null,
        });
      }
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
      log.info('Auto-translate:', newValue);
    }
  };

  const handleProviderChange = async (provider: TranslationProviderId) => {
    // Block TranslateGemma when hardware acceleration is unavailable.
    if (provider === 'translategemma' && translateGemmaAvailable() === false) {
      setError('TranslateGemma requires WebGPU or WebNN (hardware acceleration). Your browser supports neither. Use OPUS-MT for local translation instead.');
      setClearingErrorAction('Use OPUS-MT', () => handleProviderChange('opus-mt'));
      return;
    }

    setActiveProvider(provider);
    setProviderStatus('ready');
    setError(null);

    await safeStorageSet({ provider });
    try {
      await sendBackgroundMessage({ type: 'setProvider', provider });
      log.info('Provider changed to:', provider);
    } catch (error) {
      log.error('Failed to set provider:', error);
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
      log.info('Injecting content script...');
      try {
        await browserAPI.scripting.executeScript({
          target: { tabId },
          files: ['content.js'],
        });
        // Wait a bit for script to initialize
        await sleep(100);
        return true;
      } catch (injectError) {
        log.error('Failed to inject content script:', injectError);
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
        log.info('Bilingual mode:', response.enabled);
      }
    } catch (error) {
      log.error('Toggle bilingual mode failed:', error);
    }
  };

  const clearError = () => {
    setError(null);
    setErrorAction(null);
  };

  const setClearingErrorAction = (
    label: string,
    action: () => void | Promise<void>
  ) => {
    setErrorAction({
      label,
      handler: () => {
        clearError();
        void action();
      },
    });
  };

  const getTranslatableTabId = async (): Promise<number | null> => {
    const [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setError('No active tab');
      return null;
    }

    if (isRestrictedTabUrl(tab.url)) {
      setError('Cannot translate browser pages');
      return null;
    }

    const injected = await ensureContentScript(tab.id);
    if (!injected) {
      setError('Cannot access this page');
      return null;
    }

    return tab.id;
  };

  const handleError = (
    error: unknown,
    retryAction?: () => void | Promise<void>
  ) => {
    const msg = extractErrorMessage(error);
    const msgLower = msg.toLowerCase();
    const retry = retryAction || (() => handleTranslatePage());

    // Reset action
    setErrorAction(null);

    if (msg.includes('Cannot access')) {
      setError('Cannot translate this page. Browser internal pages cannot be translated.');
    } else if (msgLower.includes('not configured') || msgLower.includes('api key')) {
      setError(`${msg}`);
      setClearingErrorAction('Open Settings', openSettings);
    } else if (msgLower.includes('no network') || msgLower.includes('offline')) {
      setError('No network connection. Switch to a local model for offline translation.');
      setClearingErrorAction('Use OPUS-MT', () => handleProviderChange('opus-mt'));
    } else if (msgLower.includes('language pair') || msgLower.includes('not available') || msgLower.includes('unsupported')) {
      setError(msg);
    } else if (msgLower.includes('network') || msgLower.includes('connection') || (msgLower.includes('fetch') && !msgLower.includes('model'))) {
      setError(`Connection error. Check your internet connection.`);
      setClearingErrorAction('Retry', retry);
    } else if (msgLower.includes('rate') && msgLower.includes('limit')) {
      setError(`Rate limited. Please wait a moment before retrying.`);
      setClearingErrorAction('Retry', retry);
    } else if (msgLower.includes('timeout') || msgLower.includes('timed out')) {
      setError(`${msg}. Try with less text or wait for the model to fully load.`);
      setClearingErrorAction('Retry', retry);
    } else if (msgLower.includes('model') || msgLower.includes('pipeline') || msgLower.includes('load')) {
      setError(`${msg}. Try waiting for the model to download.`);
      setClearingErrorAction('Switch Provider', () => handleProviderChange('chrome-builtin'));
    } else if (msgLower.includes('memory') || msgLower.includes('oom')) {
      setError(`${msg}. Try closing other tabs or using a smaller text selection.`);
    } else {
      setError(msg || 'Translation failed. Please try again.');
      /* v8 ignore start -- error action handler */
      setClearingErrorAction('Retry', retry);
      /* v8 ignore stop */
    }
    // Clear error after 12 seconds (longer for action buttons)
    setTimeout(() => clearError(), 12000);
  };

  const executeTranslateCommand = async (
    type: TranslationCommand,
    fallbackError: string
  ) => {
    setIsTranslating(true);
    setError(null);

    try {
      const tabId = await getTranslatableTabId();
      if (!tabId) return;

      const response = await browserAPI.tabs.sendMessage(tabId, {
        type,
        sourceLang: sourceLang(),
        targetLang: targetLang(),
        strategy: strategy(),
        provider: activeProvider(),
      });

      if (response && typeof response === 'object' && 'success' in response && !response.success) {
        handleError(
          new Error(response.error || fallbackError),
          () => executeTranslateCommand(type, fallbackError)
        );
      }
    } catch (error) {
      log.error(type === 'translatePage' ? 'Page translation failed:' : 'Translation failed:', error);
      handleError(error, () => executeTranslateCommand(type, fallbackError));
    } finally {
      setIsTranslating(false);
    }
  };

  const handleTranslateSelection = async () => {
    await executeTranslateCommand('translateSelection', 'Translation failed');
  };

  const handleTranslatePage = async () => {
    await executeTranslateCommand('translatePage', 'Page translation failed');
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
    } catch (error) {
      log.error('Undo failed:', error);
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
          translateGemmaAvailable={translateGemmaAvailable()}
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
/* v8 ignore start */
}
/* v8 ignore stop */
