/**
 * Glossary Settings Section
 * Add term mappings, import/export, per-language glossaries
 */

import { Component, createSignal, onMount, For, Show } from 'solid-js';
import { glossary, type GlossaryStore, type GlossaryTerm } from '../../core/glossary';

const LANGUAGES = [
  { code: 'all', name: 'All Languages' },
  { code: 'en', name: 'English' },
  { code: 'fi', name: 'Finnish' },
  { code: 'de', name: 'German' },
  { code: 'fr', name: 'French' },
  { code: 'es', name: 'Spanish' },
  { code: 'sv', name: 'Swedish' },
];

export const GlossarySettings: Component = () => {
  const [terms, setTerms] = createSignal<GlossaryStore>({});
  const [selectedLanguage, setSelectedLanguage] = createSignal('all');
  const [searchQuery, setSearchQuery] = createSignal('');
  const [showAddForm, setShowAddForm] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [success, setSuccess] = createSignal<string | null>(null);

  // Form state
  const [newSource, setNewSource] = createSignal('');
  const [newTarget, setNewTarget] = createSignal('');
  const [newCaseSensitive, setNewCaseSensitive] = createSignal(false);
  const [newDescription, setNewDescription] = createSignal('');
  const [newLanguage, setNewLanguage] = createSignal('all');

  // Edit state
  const [editingTerm, setEditingTerm] = createSignal<string | null>(null);
  const [editTarget, setEditTarget] = createSignal('');
  const [editCaseSensitive, setEditCaseSensitive] = createSignal(false);
  const [editDescription, setEditDescription] = createSignal('');

  onMount(async () => {
    await loadGlossary();
  });

  const loadGlossary = async () => {
    try {
      const g = await glossary.getGlossary();
      setTerms(g);
      setError(null);
    } catch (e) {
      setError('Failed to load glossary');
      console.error('[GlossarySettings] Load error:', e);
    }
  };

  const showSuccess = (message: string) => {
    setSuccess(message);
    setTimeout(() => setSuccess(null), 3000);
  };

  const addNewTerm = async () => {
    const source = newSource().trim();
    const target = newTarget().trim();

    if (!source || !target) {
      setError('Source and target terms are required');
      return;
    }

    try {
      // Store language in description for filtering
      const description = newDescription().trim();
      const lang = newLanguage();
      const fullDesc = lang !== 'all' ? `[${lang}] ${description}` : description;

      await glossary.addTerm(source, target, newCaseSensitive(), fullDesc || undefined);

      setNewSource('');
      setNewTarget('');
      setNewCaseSensitive(false);
      setNewDescription('');
      setNewLanguage('all');
      setShowAddForm(false);

      await loadGlossary();
      showSuccess('Term added successfully');
    } catch (e) {
      setError('Failed to add term');
      console.error('[GlossarySettings] Add error:', e);
    }
  };

  const startEditing = (term: string, entry: GlossaryTerm) => {
    setEditingTerm(term);
    setEditTarget(entry.replacement);
    setEditCaseSensitive(entry.caseSensitive);
    setEditDescription(entry.description || '');
  };

  const saveEdit = async () => {
    const term = editingTerm();
    if (!term) return;

    const target = editTarget().trim();
    if (!target) {
      setError('Target term is required');
      return;
    }

    try {
      await glossary.addTerm(term, target, editCaseSensitive(), editDescription().trim() || undefined);
      setEditingTerm(null);
      await loadGlossary();
      showSuccess('Term updated');
    } catch (e) {
      setError('Failed to update term');
      console.error('[GlossarySettings] Update error:', e);
    }
  };

  const deleteTerm = async (term: string) => {
    if (!confirm(`Delete term "${term}"?`)) return;

    try {
      await glossary.removeTerm(term);
      await loadGlossary();
      showSuccess('Term deleted');
    } catch (e) {
      setError('Failed to delete term');
      console.error('[GlossarySettings] Delete error:', e);
    }
  };

  const clearAllTerms = async () => {
    if (!confirm('Delete ALL glossary terms? This cannot be undone.')) return;

    try {
      await glossary.clearGlossary();
      await loadGlossary();
      showSuccess('Glossary cleared');
    } catch (e) {
      setError('Failed to clear glossary');
      console.error('[GlossarySettings] Clear error:', e);
    }
  };

  const handleExport = async () => {
    try {
      const json = await glossary.exportGlossary();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'translate-glossary.json';
      a.click();
      URL.revokeObjectURL(url);
      showSuccess('Glossary exported');
    } catch (e) {
      setError('Failed to export glossary');
      console.error('[GlossarySettings] Export error:', e);
    }
  };

  const handleImport = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const count = await glossary.importGlossary(text);
      await loadGlossary();
      showSuccess(`Imported ${count} terms`);
      input.value = '';
    } catch (e) {
      setError('Failed to import: ' + (e instanceof Error ? e.message : 'Invalid file'));
      console.error('[GlossarySettings] Import error:', e);
    }
  };

  // Extract language from description
  const getTermLanguage = (description?: string): string => {
    if (!description) return 'all';
    const match = description.match(/^\[([a-z]{2})\]/);
    return match ? match[1] : 'all';
  };

  // Filter terms by language and search
  const filteredTerms = () => {
    const lang = selectedLanguage();
    const query = searchQuery().toLowerCase();

    return Object.entries(terms()).filter(([term, entry]) => {
      // Language filter
      if (lang !== 'all') {
        const termLang = getTermLanguage(entry.description);
        if (termLang !== 'all' && termLang !== lang) return false;
      }

      // Search filter
      if (query) {
        return (
          term.toLowerCase().includes(query) ||
          entry.replacement.toLowerCase().includes(query) ||
          entry.description?.toLowerCase().includes(query)
        );
      }

      return true;
    });
  };

  return (
    <div>
      <h2 class="section-title" style={{ "margin-bottom": "0.5rem" }}>Glossary</h2>
      <p class="section-description">
        Define custom term replacements. Terms are replaced before translation and the
        replacement is used in the output. Useful for proper nouns, technical terms, or
        company-specific vocabulary.
      </p>

      {/* Alerts */}
      <Show when={error()}>
        <div class="alert alert-error">{error()}</div>
      </Show>
      <Show when={success()}>
        <div class="alert alert-success">{success()}</div>
      </Show>

      {/* Toolbar */}
      <section class="settings-section">
        <div style={{ display: "flex", gap: "1rem", "flex-wrap": "wrap", "align-items": "center" }}>
          <div style={{ flex: "1", "min-width": "200px" }}>
            <input
              type="text"
              class="form-input"
              placeholder="Search terms..."
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
            />
          </div>

          <select
            class="form-select"
            style={{ width: "160px" }}
            value={selectedLanguage()}
            onChange={(e) => setSelectedLanguage(e.currentTarget.value)}
          >
            <For each={LANGUAGES}>
              {(lang) => <option value={lang.code}>{lang.name}</option>}
            </For>
          </select>

          <button
            class="btn btn-primary"
            onClick={() => setShowAddForm(!showAddForm())}
          >
            {showAddForm() ? 'Cancel' : '+ Add Term'}
          </button>
        </div>
      </section>

      {/* Add Form */}
      <Show when={showAddForm()}>
        <section class="settings-section">
          <h3 class="section-title" style={{ "margin-bottom": "1rem" }}>Add New Term</h3>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Source Term</label>
              <input
                type="text"
                class="form-input"
                placeholder="e.g., API"
                value={newSource()}
                onInput={(e) => setNewSource(e.currentTarget.value)}
              />
            </div>
            <div class="form-group">
              <label class="form-label">Replacement</label>
              <input
                type="text"
                class="form-input"
                placeholder="e.g., rajapinta"
                value={newTarget()}
                onInput={(e) => setNewTarget(e.currentTarget.value)}
              />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Language (optional)</label>
              <select
                class="form-select"
                value={newLanguage()}
                onChange={(e) => setNewLanguage(e.currentTarget.value)}
              >
                <For each={LANGUAGES}>
                  {(lang) => <option value={lang.code}>{lang.name}</option>}
                </For>
              </select>
              <p class="form-hint">Apply only when translating to this language</p>
            </div>
            <div class="form-group">
              <label class="form-label">Description (optional)</label>
              <input
                type="text"
                class="form-input"
                placeholder="e.g., Technical term"
                value={newDescription()}
                onInput={(e) => setNewDescription(e.currentTarget.value)}
              />
            </div>
          </div>

          <div class="toggle-container" style={{ padding: "0.5rem 0" }}>
            <div class="toggle-info">
              <span class="toggle-label">Case sensitive</span>
              <p class="toggle-description">Match exact case only (API vs api)</p>
            </div>
            <label class="toggle-switch">
              <input
                type="checkbox"
                checked={newCaseSensitive()}
                onChange={(e) => setNewCaseSensitive(e.currentTarget.checked)}
              />
              <span class="toggle-slider" />
            </label>
          </div>

          <div class="btn-group" style={{ "margin-top": "1rem" }}>
            <button class="btn btn-primary" onClick={addNewTerm}>
              Add Term
            </button>
            <button class="btn btn-secondary" onClick={() => setShowAddForm(false)}>
              Cancel
            </button>
          </div>
        </section>
      </Show>

      {/* Terms List */}
      <section class="settings-section">
        <div class="section-header">
          <h3 class="section-title">Terms ({filteredTerms().length})</h3>
        </div>

        <Show
          when={filteredTerms().length > 0}
          fallback={
            <div class="empty-state">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M4 19.5A2.5 2.5 0 016.5 17H20" stroke="currentColor" stroke-width="2" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" stroke="currentColor" stroke-width="2" />
              </svg>
              <p>
                {searchQuery() ? 'No matching terms found' : 'No glossary terms defined yet'}
              </p>
            </div>
          }
        >
          <For each={filteredTerms()}>
            {([term, entry]) => (
              <Show
                when={editingTerm() === term}
                fallback={
                  <div class="glossary-term">
                    <span class="glossary-source">{term}</span>
                    <span class="glossary-arrow">{'->'}</span>
                    <span class="glossary-target">{entry.replacement}</span>
                    <Show when={entry.caseSensitive}>
                      <span class="badge badge-info">Aa</span>
                    </Show>
                    <Show when={getTermLanguage(entry.description) !== 'all'}>
                      <span class="glossary-language">{getTermLanguage(entry.description)}</span>
                    </Show>
                    <div style={{ "margin-left": "auto", display: "flex", gap: "0.5rem" }}>
                      <button
                        class="btn btn-sm btn-ghost"
                        onClick={() => startEditing(term, entry)}
                      >
                        Edit
                      </button>
                      <button
                        class="btn btn-sm btn-ghost"
                        style={{ color: "var(--color-red-500)" }}
                        onClick={() => deleteTerm(term)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                }
              >
                {/* Edit mode */}
                <div class="glossary-term" style={{ "flex-direction": "column", "align-items": "stretch" }}>
                  <div class="form-row">
                    <div class="form-group">
                      <label class="form-label">Source</label>
                      <input type="text" class="form-input" value={term} disabled />
                    </div>
                    <div class="form-group">
                      <label class="form-label">Replacement</label>
                      <input
                        type="text"
                        class="form-input"
                        value={editTarget()}
                        onInput={(e) => setEditTarget(e.currentTarget.value)}
                      />
                    </div>
                  </div>

                  <div class="form-group">
                    <label class="form-label">Description</label>
                    <input
                      type="text"
                      class="form-input"
                      value={editDescription()}
                      onInput={(e) => setEditDescription(e.currentTarget.value)}
                    />
                  </div>

                  <div class="toggle-container" style={{ padding: "0.25rem 0" }}>
                    <span class="toggle-label">Case sensitive</span>
                    <label class="toggle-switch">
                      <input
                        type="checkbox"
                        checked={editCaseSensitive()}
                        onChange={(e) => setEditCaseSensitive(e.currentTarget.checked)}
                      />
                      <span class="toggle-slider" />
                    </label>
                  </div>

                  <div class="btn-group">
                    <button class="btn btn-primary btn-sm" onClick={saveEdit}>
                      Save
                    </button>
                    <button class="btn btn-secondary btn-sm" onClick={() => setEditingTerm(null)}>
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

          <Show when={Object.keys(terms()).length > 0}>
            <button class="btn btn-danger" onClick={clearAllTerms}>
              Clear All
            </button>
          </Show>
        </div>
      </section>
    </div>
  );
};

export default GlossarySettings;
