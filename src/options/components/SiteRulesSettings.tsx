/**
 * Site Rules Settings Section
 * Per-domain translation preferences
 */

import { Component, createSignal, onMount, For, Show } from 'solid-js';
import { siteRules, type SiteRules, type SiteRulesStore } from '../../core/site-rules';
import type { TranslationProviderId, Strategy } from '../../types';

const LANGUAGES = [
  { code: '', name: 'Use default' },
  { code: 'auto', name: 'Auto Detect' },
  { code: 'en', name: 'English' },
  { code: 'fi', name: 'Finnish' },
  { code: 'de', name: 'German' },
  { code: 'fr', name: 'French' },
  { code: 'es', name: 'Spanish' },
  { code: 'sv', name: 'Swedish' },
];

const PROVIDERS: Array<{ id: TranslationProviderId | ''; name: string }> = [
  { id: '', name: 'Use default' },
  { id: 'opus-mt', name: 'OPUS-MT (Local)' },
  { id: 'translategemma', name: 'TranslateGemma (Local)' },
  { id: 'chrome-builtin', name: 'Chrome Built-in' },
  { id: 'deepl', name: 'DeepL' },
  { id: 'openai', name: 'OpenAI' },
  { id: 'google-cloud', name: 'Google Cloud' },
  { id: 'anthropic', name: 'Claude' },
];

const STRATEGIES: Array<{ id: Strategy | ''; name: string }> = [
  { id: '', name: 'Use default' },
  { id: 'smart', name: 'Smart' },
  { id: 'fast', name: 'Fast' },
  { id: 'quality', name: 'Quality' },
  { id: 'cost', name: 'Cost' },
  { id: 'balanced', name: 'Balanced' },
];

export const SiteRulesSettings: Component = () => {
  const [allRules, setAllRules] = createSignal<SiteRulesStore>({});
  const [showAddForm, setShowAddForm] = createSignal(false);
  const [editingPattern, setEditingPattern] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [success, setSuccess] = createSignal<string | null>(null);

  // Add form state
  const [newPattern, setNewPattern] = createSignal('');
  const [newAutoTranslate, setNewAutoTranslate] = createSignal(true);
  const [newProvider, setNewProvider] = createSignal<TranslationProviderId | ''>('');
  const [newSourceLang, setNewSourceLang] = createSignal('');
  const [newTargetLang, setNewTargetLang] = createSignal('');
  const [newStrategy, setNewStrategy] = createSignal<Strategy | ''>('');

  // Edit form state
  const [editAutoTranslate, setEditAutoTranslate] = createSignal(true);
  const [editProvider, setEditProvider] = createSignal<TranslationProviderId | ''>('');
  const [editSourceLang, setEditSourceLang] = createSignal('');
  const [editTargetLang, setEditTargetLang] = createSignal('');
  const [editStrategy, setEditStrategy] = createSignal<Strategy | ''>('');

  onMount(async () => {
    await loadRules();
  });

  const loadRules = async () => {
    try {
      const rules = await siteRules.getAllRules();
      setAllRules(rules);
      setError(null);
    } catch (e) {
      setError('Failed to load site rules');
      console.error('[SiteRulesSettings] Load error:', e);
    }
  };

  const showSuccess = (message: string) => {
    setSuccess(message);
    setTimeout(() => setSuccess(null), 3000);
  };

  const addRule = async () => {
    const pattern = newPattern().trim().toLowerCase();

    if (!pattern) {
      setError('Domain pattern is required');
      return;
    }

    // Validate pattern
    if (!pattern.match(/^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z]{2,})+$/)) {
      setError('Invalid domain pattern. Examples: example.com, *.example.com');
      return;
    }

    try {
      const rules: SiteRules = {
        autoTranslate: newAutoTranslate(),
        preferredProvider: newProvider() || undefined,
        sourceLang: newSourceLang() || undefined,
        targetLang: newTargetLang() || undefined,
        strategy: newStrategy() || undefined,
      };

      await siteRules.setRules(pattern, rules);

      // Reset form
      setNewPattern('');
      setNewAutoTranslate(true);
      setNewProvider('');
      setNewSourceLang('');
      setNewTargetLang('');
      setNewStrategy('');
      setShowAddForm(false);

      await loadRules();
      showSuccess('Site rule added');
    } catch (e) {
      setError('Failed to add rule');
      console.error('[SiteRulesSettings] Add error:', e);
    }
  };

  const startEditing = (pattern: string, rules: SiteRules) => {
    setEditingPattern(pattern);
    setEditAutoTranslate(rules.autoTranslate);
    setEditProvider(rules.preferredProvider || '');
    setEditSourceLang(rules.sourceLang || '');
    setEditTargetLang(rules.targetLang || '');
    setEditStrategy(rules.strategy || '');
  };

  const saveEdit = async () => {
    const pattern = editingPattern();
    if (!pattern) return;

    try {
      const rules: SiteRules = {
        autoTranslate: editAutoTranslate(),
        preferredProvider: editProvider() || undefined,
        sourceLang: editSourceLang() || undefined,
        targetLang: editTargetLang() || undefined,
        strategy: editStrategy() || undefined,
      };

      await siteRules.setRules(pattern, rules);
      setEditingPattern(null);
      await loadRules();
      showSuccess('Site rule updated');
    } catch (e) {
      setError('Failed to update rule');
      console.error('[SiteRulesSettings] Update error:', e);
    }
  };

  const deleteRule = async (pattern: string) => {
    if (!confirm(`Delete rule for "${pattern}"?`)) return;

    try {
      await siteRules.clearRules(pattern);
      await loadRules();
      showSuccess('Rule deleted');
    } catch (e) {
      setError('Failed to delete rule');
      console.error('[SiteRulesSettings] Delete error:', e);
    }
  };

  const handleExport = async () => {
    try {
      const json = await siteRules.exportRules();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'translate-site-rules.json';
      a.click();
      URL.revokeObjectURL(url);
      showSuccess('Rules exported');
    } catch (e) {
      setError('Failed to export rules');
      console.error('[SiteRulesSettings] Export error:', e);
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
      showSuccess(`Imported ${count} rules`);
      input.value = '';
    } catch (e) {
      setError('Failed to import: ' + (e instanceof Error ? e.message : 'Invalid file'));
      console.error('[SiteRulesSettings] Import error:', e);
    }
  };

  const rulesCount = () => Object.keys(allRules()).length;

  return (
    <div>
      <h2 class="section-title" style={{ "margin-bottom": "0.5rem" }}>Site Rules</h2>
      <p class="section-description">
        Configure translation settings for specific websites. Rules can include wildcard
        patterns (e.g., *.example.com) to match multiple subdomains.
      </p>

      {/* Alerts */}
      <Show when={error()}>
        <div class="alert alert-error">{error()}</div>
      </Show>
      <Show when={success()}>
        <div class="alert alert-success">{success()}</div>
      </Show>

      {/* Add Button */}
      <section class="settings-section">
        <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
          <span style={{ color: "var(--color-gray-600)" }}>
            {rulesCount()} site {rulesCount() === 1 ? 'rule' : 'rules'} configured
          </span>
          <button
            class="btn btn-primary"
            onClick={() => setShowAddForm(!showAddForm())}
          >
            {showAddForm() ? 'Cancel' : '+ Add Site Rule'}
          </button>
        </div>
      </section>

      {/* Add Form */}
      <Show when={showAddForm()}>
        <section class="settings-section">
          <h3 class="section-title" style={{ "margin-bottom": "1rem" }}>Add Site Rule</h3>

          <div class="form-group">
            <label class="form-label">Domain Pattern</label>
            <input
              type="text"
              class="form-input"
              placeholder="example.com or *.example.com"
              value={newPattern()}
              onInput={(e) => setNewPattern(e.currentTarget.value)}
            />
            <p class="form-hint">Use *.domain.com to match all subdomains</p>
          </div>

          <div class="toggle-container">
            <div class="toggle-info">
              <span class="toggle-label">Auto-translate</span>
              <p class="toggle-description">Automatically translate pages on this site</p>
            </div>
            <label class="toggle-switch">
              <input
                type="checkbox"
                checked={newAutoTranslate()}
                onChange={(e) => setNewAutoTranslate(e.currentTarget.checked)}
              />
              <span class="toggle-slider" />
            </label>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Provider</label>
              <select
                class="form-select"
                value={newProvider()}
                onChange={(e) => setNewProvider(e.currentTarget.value as TranslationProviderId | '')}
              >
                <For each={PROVIDERS}>
                  {(p) => <option value={p.id}>{p.name}</option>}
                </For>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Strategy</label>
              <select
                class="form-select"
                value={newStrategy()}
                onChange={(e) => setNewStrategy(e.currentTarget.value as Strategy | '')}
              >
                <For each={STRATEGIES}>
                  {(s) => <option value={s.id}>{s.name}</option>}
                </For>
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Source Language</label>
              <select
                class="form-select"
                value={newSourceLang()}
                onChange={(e) => setNewSourceLang(e.currentTarget.value)}
              >
                <For each={LANGUAGES}>
                  {(lang) => <option value={lang.code}>{lang.name}</option>}
                </For>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Target Language</label>
              <select
                class="form-select"
                value={newTargetLang()}
                onChange={(e) => setNewTargetLang(e.currentTarget.value)}
              >
                <For each={LANGUAGES.filter(l => l.code !== 'auto')}>
                  {(lang) => <option value={lang.code}>{lang.name}</option>}
                </For>
              </select>
            </div>
          </div>

          <div class="btn-group" style={{ "margin-top": "1rem" }}>
            <button class="btn btn-primary" onClick={addRule}>
              Add Rule
            </button>
            <button class="btn btn-secondary" onClick={() => setShowAddForm(false)}>
              Cancel
            </button>
          </div>
        </section>
      </Show>

      {/* Rules List */}
      <section class="settings-section">
        <div class="section-header">
          <h3 class="section-title">Site Rules</h3>
        </div>

        <Show
          when={rulesCount() > 0}
          fallback={
            <div class="empty-state">
              <svg viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" />
                <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" stroke="currentColor" stroke-width="2" />
              </svg>
              <p>No site rules configured</p>
              <p style={{ "font-size": "0.875rem" }}>
                Add rules to customize translation behavior for specific websites.
              </p>
            </div>
          }
        >
          <For each={Object.entries(allRules())}>
            {([pattern, rules]) => (
              <Show
                when={editingPattern() === pattern}
                fallback={
                  <div class="site-rule">
                    <div style={{ flex: "1" }}>
                      <div class="site-domain">{pattern}</div>
                      <div class="site-settings">
                        <span class={`badge ${rules.autoTranslate ? 'badge-success' : 'badge-neutral'}`}>
                          {rules.autoTranslate ? 'Auto' : 'Manual'}
                        </span>
                        <Show when={rules.preferredProvider}>
                          <span>{PROVIDERS.find(p => p.id === rules.preferredProvider)?.name}</span>
                        </Show>
                        <Show when={rules.targetLang}>
                          <span>{'->'} {rules.targetLang}</span>
                        </Show>
                      </div>
                    </div>
                    <div class="btn-group">
                      <button
                        class="btn btn-sm btn-ghost"
                        onClick={() => startEditing(pattern, rules)}
                      >
                        Edit
                      </button>
                      <button
                        class="btn btn-sm btn-ghost"
                        style={{ color: "var(--color-red-500)" }}
                        onClick={() => deleteRule(pattern)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                }
              >
                {/* Edit mode */}
                <div class="site-rule" style={{ "flex-direction": "column", "align-items": "stretch", padding: "1rem" }}>
                  <div style={{ "font-weight": "600", "margin-bottom": "1rem" }}>{pattern}</div>

                  <div class="toggle-container" style={{ padding: "0.25rem 0" }}>
                    <span class="toggle-label">Auto-translate</span>
                    <label class="toggle-switch">
                      <input
                        type="checkbox"
                        checked={editAutoTranslate()}
                        onChange={(e) => setEditAutoTranslate(e.currentTarget.checked)}
                      />
                      <span class="toggle-slider" />
                    </label>
                  </div>

                  <div class="form-row">
                    <div class="form-group">
                      <label class="form-label">Provider</label>
                      <select
                        class="form-select"
                        value={editProvider()}
                        onChange={(e) => setEditProvider(e.currentTarget.value as TranslationProviderId | '')}
                      >
                        <For each={PROVIDERS}>
                          {(p) => <option value={p.id}>{p.name}</option>}
                        </For>
                      </select>
                    </div>
                    <div class="form-group">
                      <label class="form-label">Strategy</label>
                      <select
                        class="form-select"
                        value={editStrategy()}
                        onChange={(e) => setEditStrategy(e.currentTarget.value as Strategy | '')}
                      >
                        <For each={STRATEGIES}>
                          {(s) => <option value={s.id}>{s.name}</option>}
                        </For>
                      </select>
                    </div>
                  </div>

                  <div class="form-row">
                    <div class="form-group">
                      <label class="form-label">Source Language</label>
                      <select
                        class="form-select"
                        value={editSourceLang()}
                        onChange={(e) => setEditSourceLang(e.currentTarget.value)}
                      >
                        <For each={LANGUAGES}>
                          {(lang) => <option value={lang.code}>{lang.name}</option>}
                        </For>
                      </select>
                    </div>
                    <div class="form-group">
                      <label class="form-label">Target Language</label>
                      <select
                        class="form-select"
                        value={editTargetLang()}
                        onChange={(e) => setEditTargetLang(e.currentTarget.value)}
                      >
                        <For each={LANGUAGES.filter(l => l.code !== 'auto')}>
                          {(lang) => <option value={lang.code}>{lang.name}</option>}
                        </For>
                      </select>
                    </div>
                  </div>

                  <div class="btn-group" style={{ "margin-top": "0.5rem" }}>
                    <button class="btn btn-primary btn-sm" onClick={saveEdit}>
                      Save
                    </button>
                    <button class="btn btn-secondary btn-sm" onClick={() => setEditingPattern(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              </Show>
            )}
          </For>
        </Show>
      </section>

      {/* Import/Export */}
      <section class="settings-section">
        <div class="section-header">
          <h3 class="section-title">Import / Export</h3>
        </div>

        <div class="btn-group">
          <button class="btn btn-secondary" onClick={handleExport}>
            Export JSON
          </button>

          <div class="file-input-wrapper">
            <button class="btn btn-secondary">Import JSON</button>
            <input
              type="file"
              accept=".json"
              onChange={handleImport}
            />
          </div>
        </div>
      </section>
    </div>
  );
};

export default SiteRulesSettings;
