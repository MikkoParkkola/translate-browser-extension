/**
 * Site Rules Manager Component
 * UI for managing per-site translation preferences
 */

import { Component, createSignal, onMount, For, Show } from 'solid-js';
import { siteRules, type SiteRules, type SiteRulesStore } from '../../core/site-rules';
import type { TranslationProviderId, Strategy } from '../../types';

interface Props {
  currentHostname?: string;
  providers: Array<{ id: TranslationProviderId; name: string }>;
  languages: Array<{ code: string; name: string }>;
  onClose?: () => void;
}

export const SiteRulesManager: Component<Props> = (props) => {
  const [allRules, setAllRules] = createSignal<SiteRulesStore>({});
  const [currentSiteRules, setCurrentSiteRules] = createSignal<SiteRules | null>(null);
  const [newPattern, setNewPattern] = createSignal('');
  const [showAddForm, setShowAddForm] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Form state for current site
  const [autoTranslate, setAutoTranslate] = createSignal(false);
  const [preferredProvider, setPreferredProvider] = createSignal<TranslationProviderId | ''>('');
  const [sourceLang, setSourceLang] = createSignal('');
  const [targetLang, setTargetLang] = createSignal('');
  const [strategy, setStrategy] = createSignal<Strategy | ''>('');

  onMount(async () => {
    await loadRules();
  });

  const loadRules = async () => {
    try {
      const rules = await siteRules.getAllRules();
      setAllRules(rules);

      if (props.currentHostname) {
        const current = await siteRules.getRules(props.currentHostname);
        setCurrentSiteRules(current);
        if (current) {
          setAutoTranslate(current.autoTranslate);
          setPreferredProvider(current.preferredProvider || '');
          setSourceLang(current.sourceLang || '');
          setTargetLang(current.targetLang || '');
          setStrategy(current.strategy || '');
        }
      }
    } catch (e) {
      setError('Failed to load site rules');
      console.error('[SiteRulesManager] Load error:', e);
    }
  };

  const saveCurrentSiteRules = async () => {
    if (!props.currentHostname) return;

    try {
      const rules: SiteRules = {
        autoTranslate: autoTranslate(),
        preferredProvider: preferredProvider() || undefined,
        sourceLang: sourceLang() || undefined,
        targetLang: targetLang() || undefined,
        strategy: strategy() || undefined,
      };

      await siteRules.setRules(props.currentHostname, rules);
      setCurrentSiteRules(rules);
      await loadRules();
      setError(null);
    } catch (e) {
      setError('Failed to save rules');
      console.error('[SiteRulesManager] Save error:', e);
    }
  };

  const clearCurrentSiteRules = async () => {
    if (!props.currentHostname) return;

    try {
      await siteRules.clearRules(props.currentHostname);
      setCurrentSiteRules(null);
      setAutoTranslate(false);
      setPreferredProvider('');
      setSourceLang('');
      setTargetLang('');
      setStrategy('');
      await loadRules();
      setError(null);
    } catch (e) {
      setError('Failed to clear rules');
      console.error('[SiteRulesManager] Clear error:', e);
    }
  };

  const deleteRule = async (pattern: string) => {
    try {
      await siteRules.clearRules(pattern);
      await loadRules();
      setError(null);
    } catch (e) {
      setError('Failed to delete rule');
      console.error('[SiteRulesManager] Delete error:', e);
    }
  };

  const addNewRule = async () => {
    const pattern = newPattern().trim();
    if (!pattern) {
      setError('Pattern is required');
      return;
    }

    try {
      await siteRules.setRules(pattern, { autoTranslate: true });
      setNewPattern('');
      setShowAddForm(false);
      await loadRules();
      setError(null);
    } catch (e) {
      setError('Failed to add rule');
      console.error('[SiteRulesManager] Add error:', e);
    }
  };

  const handleExport = async () => {
    try {
      const json = await siteRules.exportRules();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'site-rules.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError('Failed to export rules');
      console.error('[SiteRulesManager] Export error:', e);
    }
  };

  const handleImport = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const count = await siteRules.importRules(text);
      await loadRules();
      setError(null);
      alert(`Imported ${count} site rules`);
    } catch (e) {
      setError('Failed to import rules: ' + (e instanceof Error ? e.message : 'Unknown error'));
      console.error('[SiteRulesManager] Import error:', e);
    }
  };

  return (
    <div class="site-rules-manager">
      <div class="site-rules-header">
        <h3>Site Rules</h3>
        <Show when={props.onClose}>
          <button class="close-button" onClick={props.onClose} aria-label="Close">
            &times;
          </button>
        </Show>
      </div>

      <Show when={error()}>
        <div class="error-message">{error()}</div>
      </Show>

      {/* Current Site Section */}
      <Show when={props.currentHostname}>
        <section class="current-site-section">
          <h4>Current Site: {props.currentHostname}</h4>

          <div class="form-group">
            <label class="toggle-label">
              <input
                type="checkbox"
                checked={autoTranslate()}
                onChange={(e) => setAutoTranslate(e.target.checked)}
              />
              <span>Auto-translate this site</span>
            </label>
          </div>

          <div class="form-group">
            <label>Preferred Provider</label>
            <select
              value={preferredProvider()}
              onChange={(e) => setPreferredProvider(e.target.value as TranslationProviderId)}
            >
              <option value="">Use default</option>
              <For each={props.providers}>
                {(provider) => <option value={provider.id}>{provider.name}</option>}
              </For>
            </select>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Source Language</label>
              <select value={sourceLang()} onChange={(e) => setSourceLang(e.target.value)}>
                <option value="">Use default</option>
                <option value="auto">Auto-detect</option>
                <For each={props.languages}>
                  {(lang) => <option value={lang.code}>{lang.name}</option>}
                </For>
              </select>
            </div>

            <div class="form-group">
              <label>Target Language</label>
              <select value={targetLang()} onChange={(e) => setTargetLang(e.target.value)}>
                <option value="">Use default</option>
                <For each={props.languages}>
                  {(lang) => <option value={lang.code}>{lang.name}</option>}
                </For>
              </select>
            </div>
          </div>

          <div class="form-group">
            <label>Strategy</label>
            <select
              value={strategy()}
              onChange={(e) => setStrategy(e.target.value as Strategy)}
            >
              <option value="">Use default</option>
              <option value="smart">Smart</option>
              <option value="fast">Fast</option>
              <option value="quality">Quality</option>
              <option value="cost">Cost</option>
              <option value="balanced">Balanced</option>
            </select>
          </div>

          <div class="button-row">
            <button class="primary-button" onClick={saveCurrentSiteRules}>
              Save Rules
            </button>
            <Show when={currentSiteRules()}>
              <button class="secondary-button" onClick={clearCurrentSiteRules}>
                Clear Rules
              </button>
            </Show>
          </div>
        </section>
      </Show>

      {/* All Rules List */}
      <section class="all-rules-section">
        <div class="section-header">
          <h4>All Site Rules</h4>
          <button class="add-button" onClick={() => setShowAddForm(!showAddForm())}>
            {showAddForm() ? 'Cancel' : '+ Add'}
          </button>
        </div>

        <Show when={showAddForm()}>
          <div class="add-form">
            <input
              type="text"
              placeholder="hostname or *.domain.com"
              value={newPattern()}
              onInput={(e) => setNewPattern(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && addNewRule()}
            />
            <button class="primary-button" onClick={addNewRule}>
              Add
            </button>
          </div>
        </Show>

        <div class="rules-list">
          <Show when={Object.keys(allRules()).length === 0}>
            <p class="empty-message">No site rules configured</p>
          </Show>

          <For each={Object.entries(allRules())}>
            {([pattern, rules]) => (
              <div class="rule-item">
                <div class="rule-info">
                  <span class="rule-pattern">{pattern}</span>
                  <span class="rule-details">
                    {rules.autoTranslate ? 'Auto-translate' : 'Manual'}
                    {rules.preferredProvider && ` | ${rules.preferredProvider}`}
                    {rules.targetLang && ` | -> ${rules.targetLang}`}
                  </span>
                </div>
                <button
                  class="delete-button"
                  onClick={() => deleteRule(pattern)}
                  aria-label={`Delete rule for ${pattern}`}
                >
                  &times;
                </button>
              </div>
            )}
          </For>
        </div>
      </section>

      {/* Import/Export */}
      <section class="import-export-section">
        <button class="secondary-button" onClick={handleExport}>
          Export Rules
        </button>
        <label class="file-input-label">
          <span>Import Rules</span>
          <input type="file" accept=".json" onChange={handleImport} />
        </label>
      </section>
    </div>
  );
};

export default SiteRulesManager;
