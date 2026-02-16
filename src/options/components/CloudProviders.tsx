/**
 * Cloud Providers Section
 * API key management for DeepL, OpenAI, Google Cloud, Anthropic
 */

import { Component, createSignal, onMount, For, Show } from 'solid-js';
import type { TranslationProviderId } from '../../types';
import { ConfirmDialog } from '../../shared/ConfirmDialog';

// Cloud provider definitions
const CLOUD_PROVIDERS = [
  {
    id: 'deepl' as TranslationProviderId,
    name: 'DeepL',
    keyField: 'deepl_api_key',
    enabledField: 'deepl_enabled',
    hasProTier: true,
    proField: 'deepl_is_pro',
    placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx',
    helpUrl: 'https://www.deepl.com/pro-api',
    description: 'Premium translation quality. Free tier: 500K chars/month.',
    testEndpoint: 'https://api-free.deepl.com/v2/usage',
  },
  {
    id: 'openai' as TranslationProviderId,
    name: 'OpenAI',
    keyField: 'openai_api_key',
    enabledField: 'openai_enabled',
    modelField: 'openai_model',
    hasProTier: false,
    placeholder: 'sk-...',
    helpUrl: 'https://platform.openai.com/api-keys',
    description: 'LLM-powered translations with context understanding.',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  },
  {
    id: 'google-cloud' as TranslationProviderId,
    name: 'Google Cloud',
    keyField: 'google_cloud_api_key',
    enabledField: 'google_cloud_enabled',
    hasProTier: false,
    placeholder: 'AIza...',
    helpUrl: 'https://cloud.google.com/translate/docs/setup',
    description: 'Google Cloud Translation API v2.',
  },
  {
    id: 'anthropic' as TranslationProviderId,
    name: 'Claude (Anthropic)',
    keyField: 'anthropic_api_key',
    enabledField: 'anthropic_enabled',
    modelField: 'anthropic_model',
    hasProTier: false,
    placeholder: 'sk-ant-...',
    helpUrl: 'https://console.anthropic.com/settings/keys',
    description: 'Claude-powered translations with nuanced understanding.',
    models: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-latest'],
  },
];

interface ProviderStatus {
  hasKey: boolean;
  enabled: boolean;
  isPro?: boolean;
  model?: string;
  testing?: boolean;
  testResult?: 'success' | 'error' | null;
  testMessage?: string;
}

export const CloudProviders: Component = () => {
  const [providerStatus, setProviderStatus] = createSignal<Record<string, ProviderStatus>>({});
  const [editingProvider, setEditingProvider] = createSignal<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = createSignal('');
  const [isProTier, setIsProTier] = createSignal(false);
  const [selectedModel, setSelectedModel] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [confirmRemove, setConfirmRemove] = createSignal<string | null>(null);

  onMount(async () => {
    await loadProviderStatus();
  });

  const loadProviderStatus = async () => {
    const status: Record<string, ProviderStatus> = {};

    try {
      const keys = CLOUD_PROVIDERS.flatMap((p) => {
        const fields = [p.keyField, p.enabledField];
        if (p.hasProTier && p.proField) fields.push(p.proField);
        if (p.modelField) fields.push(p.modelField);
        return fields;
      });

      const stored = await chrome.storage.local.get(keys);

      for (const provider of CLOUD_PROVIDERS) {
        status[provider.id] = {
          hasKey: !!stored[provider.keyField],
          enabled: stored[provider.enabledField] ?? false,
          isPro: provider.hasProTier && provider.proField ? stored[provider.proField] : undefined,
          model: provider.modelField ? stored[provider.modelField] : undefined,
        };
      }
    } catch (e) {
      console.error('[CloudProviders] Failed to load status:', e);
    }

    setProviderStatus(status);
  };

  const startEditing = (providerId: string) => {
    const provider = CLOUD_PROVIDERS.find((p) => p.id === providerId);
    const status = providerStatus()[providerId];

    setEditingProvider(providerId);
    setApiKeyInput('');
    setIsProTier(status?.isPro ?? false);
    setSelectedModel(status?.model || provider?.models?.[0] || '');
    setError(null);
  };

  const cancelEditing = () => {
    setEditingProvider(null);
    setApiKeyInput('');
    setError(null);
  };

  const saveApiKey = async (providerId: string) => {
    const provider = CLOUD_PROVIDERS.find((p) => p.id === providerId);
    if (!provider) return;

    const key = apiKeyInput().trim();
    if (!key) {
      setError('Please enter an API key');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const data: Record<string, unknown> = {
        [provider.keyField]: key,
        [provider.enabledField]: true,
      };

      if (provider.hasProTier && provider.proField) {
        data[provider.proField] = isProTier();
      }

      if (provider.modelField) {
        data[provider.modelField] = selectedModel();
      }

      await chrome.storage.local.set(data);

      setProviderStatus((prev) => ({
        ...prev,
        [providerId]: {
          hasKey: true,
          enabled: true,
          isPro: isProTier(),
          model: selectedModel(),
        },
      }));

      setEditingProvider(null);
    } catch (e) {
      console.error('[CloudProviders] Failed to save key:', e);
      setError('Failed to save API key');
    } finally {
      setSaving(false);
    }
  };

  const removeApiKey = async (providerId: string) => {
    const provider = CLOUD_PROVIDERS.find((p) => p.id === providerId);
    if (!provider) return;

    setConfirmRemove(null);
    try {
      const keysToRemove = [provider.keyField, provider.enabledField];
      if (provider.hasProTier && provider.proField) {
        keysToRemove.push(provider.proField);
      }
      if (provider.modelField) {
        keysToRemove.push(provider.modelField);
      }

      await chrome.storage.local.remove(keysToRemove);

      setProviderStatus((prev) => ({
        ...prev,
        [providerId]: { hasKey: false, enabled: false },
      }));
    } catch (e) {
      console.error('[CloudProviders] Failed to remove key:', e);
    }
  };

  const toggleProvider = async (providerId: string) => {
    const provider = CLOUD_PROVIDERS.find((p) => p.id === providerId);
    const status = providerStatus()[providerId];
    if (!provider || !status?.hasKey) return;

    const newEnabled = !status.enabled;

    try {
      await chrome.storage.local.set({ [provider.enabledField]: newEnabled });

      setProviderStatus((prev) => ({
        ...prev,
        [providerId]: { ...prev[providerId], enabled: newEnabled },
      }));
    } catch (e) {
      console.error('[CloudProviders] Failed to toggle provider:', e);
    }
  };

  const testProvider = async (providerId: string) => {
    const provider = CLOUD_PROVIDERS.find((p) => p.id === providerId);
    if (!provider) return;

    setProviderStatus((prev) => ({
      ...prev,
      [providerId]: { ...prev[providerId], testing: true, testResult: null },
    }));

    try {
      // Send test message to background script
      const response = await chrome.runtime.sendMessage({
        type: 'testProvider',
        provider: providerId,
      });

      setProviderStatus((prev) => ({
        ...prev,
        [providerId]: {
          ...prev[providerId],
          testing: false,
          testResult: response?.success ? 'success' : 'error',
          testMessage: response?.message || (response?.success ? 'Connection successful' : 'Test failed'),
        },
      }));

      // Clear result after 3 seconds
      setTimeout(() => {
        setProviderStatus((prev) => ({
          ...prev,
          [providerId]: { ...prev[providerId], testResult: null, testMessage: undefined },
        }));
      }, 3000);
    } catch (e) {
      console.error('[CloudProviders] Test failed:', e);
      setProviderStatus((prev) => ({
        ...prev,
        [providerId]: {
          ...prev[providerId],
          testing: false,
          testResult: 'error',
          testMessage: 'Test failed: ' + (e instanceof Error ? e.message : 'Unknown error'),
        },
      }));
    }
  };

  return (
    <div>
      <h2 class="section-title" style={{ "margin-bottom": "0.5rem" }}>Cloud Translation Providers</h2>
      <p class="section-description">
        Configure API keys for cloud-based translation services. Each provider offers different
        strengths - DeepL excels at European languages, while GPT models handle context better.
      </p>

      <For each={CLOUD_PROVIDERS}>
        {(provider) => {
          const status = () => providerStatus()[provider.id] || { hasKey: false, enabled: false };
          const isEditing = () => editingProvider() === provider.id;

          return (
            <div class={`provider-card ${status().enabled ? 'enabled' : ''}`}>
              <div class="provider-header">
                <div class="provider-info">
                  <span class="provider-name">{provider.name}</span>
                  <Show when={status().hasKey}>
                    <span class={`badge ${status().enabled ? 'badge-success' : 'badge-neutral'}`}>
                      {status().enabled ? 'Enabled' : 'Disabled'}
                    </span>
                    <Show when={status().isPro}>
                      <span class="badge badge-info">Pro</span>
                    </Show>
                  </Show>
                  <Show when={!status().hasKey}>
                    <span class="badge badge-neutral">Not configured</span>
                  </Show>
                </div>

                <div class="btn-group">
                  <Show when={status().hasKey && !isEditing()}>
                    <button
                      class={`btn btn-sm ${status().enabled ? 'btn-secondary' : 'btn-primary'}`}
                      onClick={() => toggleProvider(provider.id)}
                    >
                      {status().enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      class="btn btn-sm btn-secondary"
                      onClick={() => testProvider(provider.id)}
                      disabled={status().testing}
                    >
                      {status().testing ? (
                        <span class="spinner" />
                      ) : (
                        'Test'
                      )}
                    </button>
                  </Show>
                </div>
              </div>

              <p class="provider-description">{provider.description}</p>

              {/* Test Result */}
              <Show when={status().testResult}>
                <div class={`alert ${status().testResult === 'success' ? 'alert-success' : 'alert-error'}`}>
                  {status().testMessage}
                </div>
              </Show>

              {/* Edit Form */}
              <Show when={isEditing()}>
                <div class="provider-form">
                  <Show when={error()}>
                    <div class="alert alert-error">{error()}</div>
                  </Show>

                  <div class="form-group">
                    <label class="form-label">API Key</label>
                    <input
                      type="password"
                      class="form-input"
                      placeholder={provider.placeholder}
                      value={apiKeyInput()}
                      onInput={(e) => setApiKeyInput(e.currentTarget.value)}
                      autocomplete="off"
                    />
                  </div>

                  <Show when={provider.hasProTier}>
                    <div class="toggle-container" style={{ padding: "0.5rem 0" }}>
                      <div class="toggle-info">
                        <span class="toggle-label">Pro tier (paid account)</span>
                        <p class="toggle-description">Uses the paid API endpoint for higher limits</p>
                      </div>
                      <label class="toggle-switch">
                        <input
                          type="checkbox"
                          checked={isProTier()}
                          onChange={(e) => setIsProTier(e.currentTarget.checked)}
                        />
                        <span class="toggle-slider" />
                      </label>
                    </div>
                  </Show>

                  <Show when={provider.models && provider.models.length > 0}>
                    <div class="form-group">
                      <label class="form-label">Model</label>
                      <select
                        class="form-select"
                        value={selectedModel()}
                        onChange={(e) => setSelectedModel(e.currentTarget.value)}
                      >
                        <For each={provider.models}>
                          {(model) => <option value={model}>{model}</option>}
                        </For>
                      </select>
                    </div>
                  </Show>

                  <div class="provider-actions">
                    <button
                      class="btn btn-primary"
                      onClick={() => saveApiKey(provider.id)}
                      disabled={saving()}
                    >
                      {saving() ? 'Saving...' : 'Save'}
                    </button>
                    <button class="btn btn-secondary" onClick={cancelEditing}>
                      Cancel
                    </button>
                    <a
                      href={provider.helpUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="btn btn-ghost"
                    >
                      Get API key
                    </a>
                  </div>
                </div>
              </Show>

              {/* Action Buttons (when not editing) */}
              <Show when={!isEditing()}>
                <div class="provider-actions">
                  <button class="btn btn-secondary" onClick={() => startEditing(provider.id)}>
                    {status().hasKey ? 'Update API Key' : 'Add API Key'}
                  </button>
                  <Show when={status().hasKey}>
                    <button class="btn btn-danger" onClick={() => setConfirmRemove(provider.id)}>
                      Remove
                    </button>
                  </Show>
                </div>
              </Show>
            </div>
          );
        }}
      </For>

      <ConfirmDialog
        open={!!confirmRemove()}
        title="Remove API Key"
        message={`Remove ${CLOUD_PROVIDERS.find(p => p.id === confirmRemove())?.name ?? ''} API key? You will need to re-enter it to use this provider.`}
        confirmLabel="Remove"
        cancelLabel="Keep"
        variant="danger"
        onConfirm={() => {
          const id = confirmRemove();
          if (id) removeApiKey(id);
        }}
        onCancel={() => setConfirmRemove(null)}
      />
    </div>
  );
};

export default CloudProviders;
