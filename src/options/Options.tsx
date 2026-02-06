/**
 * Options Page - Full settings interface for TRANSLATE! extension
 * Sections: General, Cloud Providers, Local Models, Glossary, Site Rules, Cache
 */

import { createSignal, onMount, Show, For } from 'solid-js';
import { GeneralSettings } from './components/GeneralSettings';
import { CloudProviders } from './components/CloudProviders';
import { LocalModels } from './components/LocalModels';
import { GlossarySettings } from './components/GlossarySettings';
import { SiteRulesSettings } from './components/SiteRulesSettings';
import { CacheSettings } from './components/CacheSettings';
import './styles/options.css';

type Tab = 'general' | 'cloud' | 'local' | 'glossary' | 'sites' | 'cache';

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'cloud', label: 'Cloud Providers', icon: 'cloud' },
  { id: 'local', label: 'Local Models', icon: 'cpu' },
  { id: 'glossary', label: 'Glossary', icon: 'book' },
  { id: 'sites', label: 'Site Rules', icon: 'globe' },
  { id: 'cache', label: 'Cache', icon: 'database' },
];

export default function Options() {
  const [activeTab, setActiveTab] = createSignal<Tab>('general');
  const [loading, setLoading] = createSignal(true);

  onMount(() => {
    // Check for tab parameter in URL
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab') as Tab | null;
    if (tab && TABS.some(t => t.id === tab)) {
      setActiveTab(tab);
    }
    setLoading(false);
  });

  const renderIcon = (icon: string) => {
    switch (icon) {
      case 'settings':
        return (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" />
            <path
              d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"
              stroke="currentColor"
              stroke-width="2"
            />
          </svg>
        );
      case 'cloud':
        return (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        );
      case 'cpu':
        return (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="2" />
            <rect x="9" y="9" width="6" height="6" stroke="currentColor" stroke-width="2" />
            <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3" stroke="currentColor" stroke-width="2" />
          </svg>
        );
      case 'book':
        return (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M4 19.5A2.5 2.5 0 016.5 17H20"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        );
      case 'globe':
        return (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" />
            <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" stroke="currentColor" stroke-width="2" />
          </svg>
        );
      case 'database':
        return (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <ellipse cx="12" cy="5" rx="9" ry="3" stroke="currentColor" stroke-width="2" />
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" stroke="currentColor" stroke-width="2" />
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" stroke="currentColor" stroke-width="2" />
          </svg>
        );
      default:
        return null;
    }
  };

  return (
    <div class="options-container">
      {/* Header */}
      <header class="options-header">
        <div class="header-brand">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" class="brand-logo">
            <path
              d="M3 5h12M9 3v2m1.048 3.5A3.5 3.5 0 016.5 12a3.5 3.5 0 01-2.45-5.943M6 16l-2 6 3-2 3 2-2-6M21 21l-6-6m6 0l-6 6M15 15l6-6m-6 0l6 6"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <div class="brand-text">
            <h1>TRANSLATE! Settings</h1>
            <span class="brand-subtitle">Configure your translation preferences</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div class="options-content">
        {/* Sidebar Navigation */}
        <nav class="options-nav">
          <For each={TABS}>
            {(tab) => (
              <button
                class={`nav-item ${activeTab() === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {renderIcon(tab.icon)}
                <span>{tab.label}</span>
              </button>
            )}
          </For>
        </nav>

        {/* Tab Content */}
        <main class="options-main">
          <Show when={!loading()} fallback={<div class="loading">Loading...</div>}>
            <Show when={activeTab() === 'general'}>
              <GeneralSettings />
            </Show>
            <Show when={activeTab() === 'cloud'}>
              <CloudProviders />
            </Show>
            <Show when={activeTab() === 'local'}>
              <LocalModels />
            </Show>
            <Show when={activeTab() === 'glossary'}>
              <GlossarySettings />
            </Show>
            <Show when={activeTab() === 'sites'}>
              <SiteRulesSettings />
            </Show>
            <Show when={activeTab() === 'cache'}>
              <CacheSettings />
            </Show>
          </Show>
        </main>
      </div>

      {/* Footer */}
      <footer class="options-footer">
        <span>TRANSLATE! v2.0 by Mikko</span>
        <span class="footer-divider">|</span>
        <a href="https://github.com/your-repo" target="_blank" rel="noopener noreferrer">
          Documentation
        </a>
      </footer>
    </div>
  );
}
