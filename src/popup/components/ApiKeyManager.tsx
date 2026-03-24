/**
 * API Key Manager Component
 * Manages API keys for cloud translation providers
 */

import { Component, createSignal, For, Show, onMount } from 'solid-js';
import { ConfirmDialog } from '../../shared/ConfirmDialog';
import { CLOUD_PROVIDER_CONFIGS } from '../../shared/cloud-provider-configs';
import { reportUiError, showTemporaryMessage } from '../../shared/ui-feedback';
import {
  getCloudProviderStorageKeys,
  hasStoredApiKey,
  readStoredBoolean,
  type CloudProviderStorageRecord,
} from '../../shared/cloud-provider-storage';
import { createLogger } from '../../core/logger';
import { safeStorageGet, safeStorageSet, safeStorageRemove } from '../../core/storage';

const log = createLogger('ApiKeyManager');

// Cloud provider definitions sourced from shared config

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
  const [confirmRemove, setConfirmRemove] = createSignal<string | null>(null);

  // Load current status on mount
  onMount(async () => {
    await loadProviderStatus();
  });

  const loadProviderStatus = async () => {
    const status: Record<string, ProviderStatus> = {};

    try {
      const stored = await safeStorageGet<CloudProviderStorageRecord>(
        getCloudProviderStorageKeys(CLOUD_PROVIDER_CONFIGS)
      );

      for (const provider of CLOUD_PROVIDER_CONFIGS) {
        status[provider.id] = {
          hasKey: hasStoredApiKey(stored, provider.keyField),
          isPro: provider.hasProTier ? readStoredBoolean(stored, provider.proField) : undefined,
        };
      }
    } catch (error) {
      log.error('Failed to load status:', error);
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
    const provider = CLOUD_PROVIDER_CONFIGS.find(p => p.id === providerId);
    /* v8 ignore start -- guard: provider always found from own button handlers */
    if (!provider) return;
    /* v8 ignore stop */

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

      const ok = await safeStorageSet(data);

      if (!ok) {
        setError('Failed to save API key');
        return;
      }

      setProviderStatus(prev => ({
        ...prev,
        [providerId]: { hasKey: true, isPro: isProTier() },
      }));

      showTemporaryMessage(
        setSuccess,
        `${provider.name} API key saved successfully`,
        1500,
        () => setEditingProvider(null)
      );
    } catch (error) {
      reportUiError(setError, log, 'Failed to save API key', 'Failed to save key:', error);
    } finally {
      setSaving(false);
    }
  };

  const removeApiKey = async (providerId: string) => {
    const provider = CLOUD_PROVIDER_CONFIGS.find(p => p.id === providerId);
    /* v8 ignore start -- guard */
    if (!provider) return;
    /* v8 ignore stop */

    try {
      const keysToRemove = [provider.keyField];
      if (provider.hasProTier && provider.proField) {
        keysToRemove.push(provider.proField);
      }

      const ok = await safeStorageRemove(keysToRemove);
      if (!ok) {
        setError('Failed to remove API key');
        return;
      }

      setProviderStatus(prev => ({
        ...prev,
        [providerId]: { hasKey: false, isPro: undefined },
      }));

      showTemporaryMessage(setSuccess, `${provider.name} API key removed`, 1500);
    } catch (error) {
      reportUiError(setError, log, 'Failed to remove API key', 'Failed to remove key:', error);
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
        <For each={CLOUD_PROVIDER_CONFIGS}>
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
                          onClick={() => setConfirmRemove(provider.id)}
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

      {/* v8 ignore start -- optional chaining + nullish coalescing + guard */}
      <ConfirmDialog
        open={!!confirmRemove()}
        title="Remove API Key"
        message={`Remove ${CLOUD_PROVIDER_CONFIGS.find(p => p.id === confirmRemove())?.name ?? ''} API key? You will need to re-enter it to use this provider.`}
        confirmLabel="Remove"
        cancelLabel="Keep"
        variant="danger"
        onConfirm={() => {
          const id = confirmRemove();
          setConfirmRemove(null);
          if (id) removeApiKey(id);
        }}
        onCancel={() => setConfirmRemove(null)}
      />
      {/* v8 ignore stop */}
    </div>
  );
};

/* v8 ignore start */
export default ApiKeyManager;
/* v8 ignore stop */
