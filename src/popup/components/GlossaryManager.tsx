/**
 * Glossary Manager Component
 * UI for managing custom term replacements
 */

import { Component, createSignal, onMount, For, Show } from 'solid-js';
import { glossary, type GlossaryStore, type GlossaryTerm } from '../../core/glossary';

interface Props {
  onClose?: () => void;
}

export const GlossaryManager: Component<Props> = (props) => {
  const [terms, setTerms] = createSignal<GlossaryStore>({});
  const [showAddForm, setShowAddForm] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [searchQuery, setSearchQuery] = createSignal('');

  // Form state
  const [newTerm, setNewTerm] = createSignal('');
  const [newReplacement, setNewReplacement] = createSignal('');
  const [newCaseSensitive, setNewCaseSensitive] = createSignal(false);
  const [newDescription, setNewDescription] = createSignal('');

  // Edit state
  const [editingTerm, setEditingTerm] = createSignal<string | null>(null);
  const [editReplacement, setEditReplacement] = createSignal('');
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
      console.error('[GlossaryManager] Load error:', e);
    }
  };

  const addNewTerm = async () => {
    const term = newTerm().trim();
    const replacement = newReplacement().trim();

    if (!term || !replacement) {
      setError('Term and replacement are required');
      return;
    }

    try {
      await glossary.addTerm(term, replacement, newCaseSensitive(), newDescription().trim() || undefined);
      setNewTerm('');
      setNewReplacement('');
      setNewCaseSensitive(false);
      setNewDescription('');
      setShowAddForm(false);
      await loadGlossary();
    } catch (e) {
      setError('Failed to add term');
      console.error('[GlossaryManager] Add error:', e);
    }
  };

  const startEditing = (term: string, entry: GlossaryTerm) => {
    setEditingTerm(term);
    setEditReplacement(entry.replacement);
    setEditCaseSensitive(entry.caseSensitive);
    setEditDescription(entry.description || '');
  };

  const saveEdit = async () => {
    const term = editingTerm();
    if (!term) return;

    const replacement = editReplacement().trim();
    if (!replacement) {
      setError('Replacement is required');
      return;
    }

    try {
      await glossary.addTerm(term, replacement, editCaseSensitive(), editDescription().trim() || undefined);
      setEditingTerm(null);
      await loadGlossary();
    } catch (e) {
      setError('Failed to update term');
      console.error('[GlossaryManager] Update error:', e);
    }
  };

  const cancelEdit = () => {
    setEditingTerm(null);
  };

  const deleteTerm = async (term: string) => {
    try {
      await glossary.removeTerm(term);
      await loadGlossary();
    } catch (e) {
      setError('Failed to delete term');
      console.error('[GlossaryManager] Delete error:', e);
    }
  };

  const clearAllTerms = async () => {
    if (!confirm('Are you sure you want to clear all glossary terms?')) {
      return;
    }

    try {
      await glossary.clearGlossary();
      await loadGlossary();
    } catch (e) {
      setError('Failed to clear glossary');
      console.error('[GlossaryManager] Clear error:', e);
    }
  };

  const handleExport = async () => {
    try {
      const json = await glossary.exportGlossary();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'glossary.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError('Failed to export glossary');
      console.error('[GlossaryManager] Export error:', e);
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
      setError(null);
      alert(`Imported ${count} glossary terms`);
    } catch (e) {
      setError('Failed to import glossary: ' + (e instanceof Error ? e.message : 'Unknown error'));
      console.error('[GlossaryManager] Import error:', e);
    }
  };

  const filteredTerms = () => {
    const query = searchQuery().toLowerCase();
    if (!query) return Object.entries(terms());

    return Object.entries(terms()).filter(
      ([term, entry]) =>
        term.toLowerCase().includes(query) ||
        entry.replacement.toLowerCase().includes(query) ||
        entry.description?.toLowerCase().includes(query)
    );
  };

  return (
    <div class="glossary-manager">
      <div class="glossary-header">
        <h3>Glossary</h3>
        <Show when={props.onClose}>
          <button class="close-button" onClick={props.onClose} aria-label="Close">
            &times;
          </button>
        </Show>
      </div>

      <p class="glossary-description">
        Define custom term replacements. Terms are replaced before translation and restored after.
      </p>

      <Show when={error()}>
        <div class="error-message">{error()}</div>
      </Show>

      {/* Search and Add */}
      <div class="glossary-toolbar">
        <input
          type="text"
          class="search-input"
          placeholder="Search terms..."
          value={searchQuery()}
          onInput={(e) => setSearchQuery(e.target.value)}
        />
        <button class="add-button" onClick={() => setShowAddForm(!showAddForm())}>
          {showAddForm() ? 'Cancel' : '+ Add Term'}
        </button>
      </div>

      {/* Add Form */}
      <Show when={showAddForm()}>
        <div class="add-term-form">
          <div class="form-row">
            <div class="form-group">
              <label>Original Term</label>
              <input
                type="text"
                placeholder="e.g., API"
                value={newTerm()}
                onInput={(e) => setNewTerm(e.target.value)}
              />
            </div>
            <div class="form-group">
              <label>Replacement</label>
              <input
                type="text"
                placeholder="e.g., rajapinta"
                value={newReplacement()}
                onInput={(e) => setNewReplacement(e.target.value)}
              />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Description (optional)</label>
              <input
                type="text"
                placeholder="e.g., Technical term for interface"
                value={newDescription()}
                onInput={(e) => setNewDescription(e.target.value)}
              />
            </div>
          </div>

          <div class="form-row">
            <label class="checkbox-label">
              <input
                type="checkbox"
                checked={newCaseSensitive()}
                onChange={(e) => setNewCaseSensitive(e.target.checked)}
              />
              <span>Case sensitive</span>
            </label>
          </div>

          <button class="primary-button" onClick={addNewTerm}>
            Add Term
          </button>
        </div>
      </Show>

      {/* Terms List */}
      <div class="terms-list">
        <Show when={filteredTerms().length === 0}>
          <p class="empty-message">
            {searchQuery() ? 'No matching terms found' : 'No glossary terms defined'}
          </p>
        </Show>

        <For each={filteredTerms()}>
          {([term, entry]) => (
            <div class="term-item">
              <Show
                when={editingTerm() === term}
                fallback={
                  <>
                    <div class="term-info" onClick={() => startEditing(term, entry)}>
                      <span class="term-original">{term}</span>
                      <span class="term-arrow">{'→'}</span>
                      <span class="term-replacement">{entry.replacement}</span>
                      <Show when={entry.caseSensitive}>
                        <span class="term-badge">Aa</span>
                      </Show>
                    </div>
                    <Show when={entry.description}>
                      <div class="term-description">{entry.description}</div>
                    </Show>
                    <button
                      class="delete-button"
                      onClick={() => deleteTerm(term)}
                      aria-label={`Delete term ${term}`}
                    >
                      &times;
                    </button>
                  </>
                }
              >
                {/* Edit mode */}
                <div class="term-edit-form">
                  <div class="form-row">
                    <div class="form-group">
                      <label>Term</label>
                      <input type="text" value={term} disabled />
                    </div>
                    <div class="form-group">
                      <label>Replacement</label>
                      <input
                        type="text"
                        value={editReplacement()}
                        onInput={(e) => setEditReplacement(e.target.value)}
                      />
                    </div>
                  </div>
                  <div class="form-group">
                    <label>Description</label>
                    <input
                      type="text"
                      value={editDescription()}
                      onInput={(e) => setEditDescription(e.target.value)}
                    />
                  </div>
                  <div class="form-row">
                    <label class="checkbox-label">
                      <input
                        type="checkbox"
                        checked={editCaseSensitive()}
                        onChange={(e) => setEditCaseSensitive(e.target.checked)}
                      />
                      <span>Case sensitive</span>
                    </label>
                  </div>
                  <div class="button-row">
                    <button class="primary-button" onClick={saveEdit}>
                      Save
                    </button>
                    <button class="secondary-button" onClick={cancelEdit}>
                      Cancel
                    </button>
                  </div>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>

      {/* Import/Export/Clear */}
      <section class="glossary-actions">
        <button class="secondary-button" onClick={handleExport}>
          Export
        </button>
        <label class="file-input-label">
          <span>Import</span>
          <input type="file" accept=".json" onChange={handleImport} />
        </label>
        <Show when={Object.keys(terms()).length > 0}>
          <button class="danger-button" onClick={clearAllTerms}>
            Clear All
          </button>
        </Show>
      </section>

      {/* Stats */}
      <div class="glossary-stats">
        {Object.keys(terms()).length} terms defined
      </div>
    </div>
  );
};

export default GlossaryManager;
