/**
 * General Settings Section
 * Default languages, translation strategy
 */

import { Component, createSignal, onMount, For } from 'solid-js';
import { safeStorageGet, safeStorageSet, lastStorageError } from '../../core/storage';
import type { Strategy } from '../../types';

const LANGUAGES = [
  { code: 'auto', name: 'Auto Detect' },
  { code: 'en', name: 'English' },
  { code: 'fi', name: 'Finnish' },
  { code: 'de', name: 'German' },
  { code: 'fr', name: 'French' },
  { code: 'es', name: 'Spanish' },
  { code: 'sv', name: 'Swedish' },
  { code: 'ru', name: 'Russian' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'nl', name: 'Dutch' },
  { code: 'cs', name: 'Czech' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'it', name: 'Italian' },
  { code: 'pl', name: 'Polish' },
  { code: 'ko', name: 'Korean' },
];

const STRATEGIES: Array<{ id: Strategy; name: string; description: string }> = [
  { id: 'smart', name: 'Smart', description: 'Auto-select best provider based on content' },
  { id: 'fast', name: 'Fast', description: 'Prioritize speed over quality' },
  { id: 'quality', name: 'Quality', description: 'Prioritize accuracy over speed' },
  { id: 'cost', name: 'Cost', description: 'Prioritize free/local providers' },
  { id: 'balanced', name: 'Balanced', description: 'Balance between speed, quality, and cost' },
];

interface StoredSettings {
  sourceLang?: string;
  targetLang?: string;
  strategy?: Strategy;
  autoTranslate?: boolean;
}

export const GeneralSettings: Component = () => {
  const [sourceLang, setSourceLang] = createSignal('auto');
  const [targetLang, setTargetLang] = createSignal('en');
  const [strategy, setStrategy] = createSignal<Strategy>('smart');
  const [autoTranslate, setAutoTranslate] = createSignal(false);
  const [saved, setSaved] = createSignal(false);
  const [saving, setSaving] = createSignal(false);

  onMount(async () => {
    const stored = await safeStorageGet<StoredSettings>([
      'sourceLang',
      'targetLang',
      'strategy',
      'autoTranslate',
    ]);

    if (stored.sourceLang) setSourceLang(stored.sourceLang);
    if (stored.targetLang) setTargetLang(stored.targetLang);
    if (stored.strategy) setStrategy(stored.strategy);
    if (stored.autoTranslate !== undefined) setAutoTranslate(stored.autoTranslate);
  });

  const [saveError, setSaveError] = createSignal<string | null>(null);

  const saveSettings = async () => {
    setSaving(true);
    setSaveError(null);
    const success = await safeStorageSet({
      sourceLang: sourceLang(),
      targetLang: targetLang(),
      strategy: strategy(),
      autoTranslate: autoTranslate(),
    });

    setSaving(false);
    if (success) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } else {
      setSaveError(lastStorageError || 'Failed to save settings. Please try again.');
    }
  };

  return (
    <div>
      <h2 class="section-title" style={{ "margin-bottom": "1.5rem" }}>General Settings</h2>

      {/* Language Defaults */}
      <section class="settings-section">
        <div class="section-header">
          <div>
            <h3 class="section-title">Default Languages</h3>
            <p class="section-subtitle">Set your preferred source and target languages</p>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Source Language</label>
            <select
              class="form-select"
              value={sourceLang()}
              onChange={(e) => setSourceLang(e.currentTarget.value)}
            >
              <For each={LANGUAGES}>
                {(lang) => <option value={lang.code}>{lang.name}</option>}
              </For>
            </select>
            <p class="form-hint">Auto Detect works best in most cases</p>
          </div>

          <div class="form-group">
            <label class="form-label">Target Language</label>
            <select
              class="form-select"
              value={targetLang()}
              onChange={(e) => setTargetLang(e.currentTarget.value)}
            >
              <For each={LANGUAGES.filter(l => l.code !== 'auto')}>
                {(lang) => <option value={lang.code}>{lang.name}</option>}
              </For>
            </select>
            <p class="form-hint">The language you want text translated into</p>
          </div>
        </div>
      </section>

      {/* Translation Strategy */}
      <section class="settings-section">
        <div class="section-header">
          <div>
            <h3 class="section-title">Translation Strategy</h3>
            <p class="section-subtitle">How translations should be processed</p>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Default Strategy</label>
          <select
            class="form-select"
            value={strategy()}
            onChange={(e) => setStrategy(e.currentTarget.value as Strategy)}
          >
            <For each={STRATEGIES}>
              {(s) => <option value={s.id}>{s.name} - {s.description}</option>}
            </For>
          </select>
        </div>
      </section>

      {/* Auto-Translate */}
      <section class="settings-section">
        <div class="section-header">
          <div>
            <h3 class="section-title">Automatic Translation</h3>
            <p class="section-subtitle">Configure automatic page translation</p>
          </div>
        </div>

        <div class="toggle-container">
          <div class="toggle-info">
            <span class="toggle-label">Auto-translate pages</span>
            <p class="toggle-description">
              Automatically translate pages when the source language differs from your target language
            </p>
          </div>
          <label class="toggle-switch">
            <input
              type="checkbox"
              checked={autoTranslate()}
              onChange={(e) => setAutoTranslate(e.currentTarget.checked)}
            />
            <span class="toggle-slider" />
          </label>
        </div>
      </section>

      {/* Save Button */}
      <div class="btn-group" style={{ "margin-top": "1.5rem" }}>
        <button class="btn btn-primary btn-lg" onClick={saveSettings} disabled={saving()}>
          {saving() ? (
            <>
              <span class="spinner" />
              Saving...
            </>
          ) : saved() ? (
            'Saved!'
          ) : (
            'Save Settings'
          )}
        </button>
      </div>
      {saveError() && (
        <div style={{ color: '#dc2626', "margin-top": "0.5rem", "font-size": "0.875rem" }}>
          {saveError()}
        </div>
      )}
    </div>
  );
};

export default GeneralSettings;
