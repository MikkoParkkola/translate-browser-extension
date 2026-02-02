import { createSignal, onMount, Show } from 'solid-js';
import { ProviderStatus } from './components/ProviderStatus';
import { LanguageSelector } from './components/LanguageSelector';
import { StrategySelector } from './components/StrategySelector';
import { UsageBar } from './components/UsageBar';
import { CostMonitor } from './components/CostMonitor';
import type { Strategy, UsageStats } from '../types';

export default function App() {
  const [sourceLang, setSourceLang] = createSignal('auto');
  const [targetLang, setTargetLang] = createSignal('fi');
  const [strategy, setStrategy] = createSignal<Strategy>('smart');
  const [providerName, _setProviderName] = createSignal('Helsinki-NLP OPUS-MT');
  const [providerStatus, _setProviderStatus] = createSignal<'ready' | 'loading' | 'error'>('ready');
  const [isTranslating, setIsTranslating] = createSignal(false);
  const [usage, _setUsage] = createSignal<UsageStats>({
    today: { requests: 0, characters: 0, cost: 0 },
    budget: { monthly: 2.0, used: 0 },
  });

  onMount(async () => {
    // Load saved preferences
    try {
      const stored = await chrome.storage.local.get(['sourceLang', 'targetLang', 'strategy']);
      if (stored.sourceLang) setSourceLang(stored.sourceLang);
      if (stored.targetLang) setTargetLang(stored.targetLang);
      if (stored.strategy) setStrategy(stored.strategy);
    } catch (e) {
      console.log('[Popup] Storage not available:', e);
    }
  });

  const handleTranslateSelection = async () => {
    setIsTranslating(true);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'translateSelection',
          sourceLang: sourceLang(),
          targetLang: targetLang(),
          strategy: strategy(),
        });
      }
    } catch (e) {
      console.error('[Popup] Translation failed:', e);
    } finally {
      setIsTranslating(false);
    }
  };

  const handleTranslatePage = async () => {
    setIsTranslating(true);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'translatePage',
          sourceLang: sourceLang(),
          targetLang: targetLang(),
          strategy: strategy(),
        });
      }
    } catch (e) {
      console.error('[Popup] Page translation failed:', e);
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
      </header>

      <main class="popup-main">
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

        {/* Action Buttons */}
        <section class="action-section">
          <button
            class="action-button action-button--primary"
            onClick={handleTranslateSelection}
            disabled={isTranslating()}
          >
            <Show when={!isTranslating()} fallback={<span class="spinner" />}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 2l3.09 6.26L22 9l-5 4.87L18.18 22 12 18.77 5.82 22 7 13.87 2 9l6.91-.74L12 2z"
                  stroke="currentColor"
                  stroke-width="2"
                  fill="none"
                />
              </svg>
            </Show>
            <span>Translate Selection</span>
          </button>

          <button
            class="action-button action-button--secondary"
            onClick={handleTranslatePage}
            disabled={isTranslating()}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M4 6h16M4 10h16M4 14h16M4 18h16" stroke="currentColor" stroke-width="2" />
            </svg>
            <span>Translate Page</span>
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
