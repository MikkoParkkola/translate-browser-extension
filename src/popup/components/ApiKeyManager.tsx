/**
 * API Key Manager Component
 * Manages API keys for cloud translation providers
 */

import { Component, createSignal, For, Show, onMount } from 'solid-js';
import type { TranslationProviderId } from '../../types';

// Cloud provider definitions
const CLOUD_PROVIDERS = [
  {
    id: 'deepl' as TranslationProviderId,
    name: 'DeepL',
    keyField: 'deepl_api_key',
    hasProTier: true,
    proField: 'deepl_is_pro',
    placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx',
    helpUrl: 'https://www.deepl.com/pro-api',
    description: 'Premium translation quality. Free tier: 500K chars/month.',
  },
  {
    id: 'openai' as TranslationProviderId,
    name: 'OpenAI',
    keyField: 'openai_api_key',
    hasProTier: false,
    placeholder: 'sk-...',
    helpUrl: 'https://platform.openai.com/api-keys',
    description: 'GPT-4 powered translations with context understanding.',
  },
  {
    id: 'google-cloud' as TranslationProviderId,
    name: 'Google Cloud',
    keyField: 'google_cloud_api_key',
    hasProTier: false,
    placeholder: 'AIza...',
    helpUrl: 'https://cloud.google.com/translate/docs/setup',
    description: 'Google Cloud Translation API v2.',
  },
  {
    id: 'anthropic' as TranslationProviderId,
    name: 'Claude',
    keyField: 'anthropic_api_key',
    hasProTier: false,
    placeholder: 'sk-ant-...',
    helpUrl: 'https://console.anthropic.com/settings/keys',
    description: 'Claude-powered translations with nuanced understanding.',
  },
];

interface ProviderStatus {
  hasKey: boolean;
  isPro?: boolean;
}

interface Props {
  onClose?: () => void;
}

export const ApiKeyManager: Component<Props> = (props) => {
  const [providerStatus, setProviderStatus] = createSignal<Record<string, ProviderStatus>>({});
  const [editingProvider, setEditingProvider] = createSignal<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = createSignal('');
  const [isProTier, setIsProTier] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [success, setSuccess] = createSignal<string | null>(null);

  // Load current status on mount
  onMount(async () => {
    await loadProviderStatus();
  });

  const loadProviderStatus = async () => {
    const status: Record<string, ProviderStatus> = {};

    try {
      const keys = CLOUD_PROVIDERS.flatMap(p =>
        p.hasProTier && p.proField ? [p.keyField, p.proField] : [p.keyField]
      );
      const stored = await chrome.storage.local.get(keys);

      for (const provider of CLOUD_PROVIDERS) {
        status[provider.id] = {
          hasKey: !!stored[provider.keyField],
          isPro: provider.hasProTier && provider.proField ? stored[provider.proField] : undefined,
        };
      }
    } catch (e) {
      console.error('[ApiKeyManager] Failed to load status:', e);
    }

    setProviderStatus(status);
  };

  const startEditing = (providerId: string) => {
    setEditingProvider(providerId);
    setApiKeyInput('');
    setIsProTier(providerStatus()[providerId]?.isPro ?? false);
    setError(null);
    setSuccess(null);
  };

  const cancelEditing = () => {
    setEditingProvider(null);
    setApiKeyInput('');
    setError(null);
    setSuccess(null);
  };

  const saveApiKey = async (providerId: string) => {
    const provider = CLOUD_PROVIDERS.find(p => p.id === providerId);
    if (!provider) return;

    const key = apiKeyInput().trim();
    if (!key) {
      setError('Please enter an API key');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const data: Record<string, unknown> = { [provider.keyField]: key };
      if (provider.hasProTier && provider.proField) {
        data[provider.proField] = isProTier();
      }

      await chrome.storage.local.set(data);

      setProviderStatus(prev => ({
        ...prev,
        [providerId]: { hasKey: true, isPro: isProTier() },
      }));

      setSuccess(`${provider.name} API key saved successfully`);
      setTimeout(() => {
        setSuccess(null);
        setEditingProvider(null);
      }, 1500);
    } catch (e) {
      console.error('[ApiKeyManager] Failed to save key:', e);
      setError('Failed to save API key');
    } finally {
      setSaving(false);
    }
  };

  const removeApiKey = async (providerId: string) => {
    const provider = CLOUD_PROVIDERS.find(p => p.id === providerId);
    if (!provider) return;

    try {
      const keysToRemove = [provider.keyField];
      if (provider.hasProTier && provider.proField) {
        keysToRemove.push(provider.proField);
      }

      await chrome.storage.local.remove(keysToRemove);

      setProviderStatus(prev => ({
        ...prev,
        [providerId]: { hasKey: false, isPro: undefined },
      }));

      setSuccess(`${provider.name} API key removed`);
      setTimeout(() => setSuccess(null), 1500);
    } catch (e) {
      console.error('[ApiKeyManager] Failed to remove key:', e);
      setError('Failed to remove API key');
    }
  };

  return (
    <div class="api-key-manager">
      <div class="api-key-header">
        <h3 class="api-key-title">Cloud Translation Providers</h3>
        <Show when={props.onClose}>
          <button class="api-key-close" onClick={props.onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M6 18L18 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </Show>
      </div>

      <Show when={success()}>
        <div class="api-key-success">{success()}</div>
      </Show>

      <div class="api-key-providers">
        <For each={CLOUD_PROVIDERS}>
          {(provider) => {
            const status = () => providerStatus()[provider.id] || { hasKey: false };
            const isEditing = () => editingProvider() === provider.id;

            return (
              <div class="api-key-provider">
                <div class="api-key-provider-header">
                  <div class="api-key-provider-info">
                    <span class="api-key-provider-name">{provider.name}</span>
                    <Show when={status().hasKey}>
                      <span class="api-key-status api-key-status--configured">
                        {status().isPro ? 'Pro' : 'Configured'}
                      </span>
                    </Show>
                    <Show when={!status().hasKey}>
                      <span class="api-key-status api-key-status--missing">Not configured</span>
                    </Show>
                  </div>
                  <div class="api-key-provider-actions">
                    <Show when={!isEditing()}>
                      <button
                        class="api-key-btn api-key-btn--edit"
                        onClick={() => startEditing(provider.id)}
                      >
                        {status().hasKey ? 'Update' : 'Add'}
                      </button>
                      <Show when={status().hasKey}>
                        <button
                          class="api-key-btn api-key-btn--remove"
                          onClick={() => removeApiKey(provider.id)}
                        >
                          Remove
                        </button>
                      </Show>
                    </Show>
                  </div>
                </div>

                <p class="api-key-provider-desc">{provider.description}</p>

                <Show when={isEditing()}>
                  <div class="api-key-form">
                    <Show when={error()}>
                      <div class="api-key-error">{error()}</div>
                    </Show>

                    <input
                      type="password"
                      class="api-key-input"
                      placeholder={provider.placeholder}
                      value={apiKeyInput()}
                      onInput={(e) => setApiKeyInput(e.currentTarget.value)}
                      autocomplete="off"
                    />

                    <Show when={provider.hasProTier}>
                      <label class="api-key-pro-toggle">
                        <input
                          type="checkbox"
                          checked={isProTier()}
                          onChange={(e) => setIsProTier(e.currentTarget.checked)}
                        />
                        <span class="toggle-slider-small"></span>
                        <span>Pro tier (paid account)</span>
                      </label>
                    </Show>

                    <div class="api-key-form-actions">
                      <button
                        class="api-key-btn api-key-btn--save"
                        onClick={() => saveApiKey(provider.id)}
                        disabled={saving()}
                      >
                        {saving() ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        class="api-key-btn api-key-btn--cancel"
                        onClick={cancelEditing}
                      >
                        Cancel
                      </button>
                      <a
                        href={provider.helpUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="api-key-help-link"
                      >
                        Get API key
                      </a>
                    </div>
                  </div>
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
};

export default ApiKeyManager;
