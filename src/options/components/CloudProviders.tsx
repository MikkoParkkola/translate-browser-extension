/**
 * Cloud Providers Section
 * API key management for DeepL, OpenAI, Google Cloud, Anthropic
 */

import { Component, createSignal, onMount, For, Show } from 'solid-js';
import { ConfirmDialog } from '../../shared/ConfirmDialog';
import { getCloudProviderConfig } from '../../shared/cloud-provider-configs';
import {
  OPTIONS_CLOUD_PROVIDERS as CLOUD_PROVIDERS,
} from '../../shared/provider-options';
import { reportUiError } from '../../shared/ui-feedback';
import {
  sendBackgroundMessage,
  sendBackgroundMessageWithUiError,
} from '../../shared/background-message';
import {
  applySavedCloudProviderStatus,
  createRemovedCloudProviderStatus,
  getCloudProviderEditDefaults,
  loadCloudProviderUiStatus,
  type CloudProviderUiStatus,
} from '../../shared/cloud-provider-ui-state';
import { createLogger } from '../../core/logger';
import { extractErrorMessage } from '../../core/errors';
import type { CloudProviderId } from '../../types';

const log = createLogger('CloudProviders');

export const CloudProviders: Component = () => {
  const [providerStatus, setProviderStatus] = createSignal<Partial<Record<CloudProviderId, CloudProviderUiStatus>>>({});
  const [editingProvider, setEditingProvider] = createSignal<CloudProviderId | null>(null);
  const [apiKeyInput, setApiKeyInput] = createSignal('');
  const [isProTier, setIsProTier] = createSignal(false);
  const [selectedModel, setSelectedModel] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [confirmRemove, setConfirmRemove] = createSignal<CloudProviderId | null>(null);

  onMount(async () => {
    await loadProviderStatus();
  });

  const loadProviderStatus = async () => {
    try {
      setProviderStatus(await loadCloudProviderUiStatus(CLOUD_PROVIDERS));
    } catch (error) {
      log.error('Failed to load status:', error);
      setProviderStatus({});
    }
  };

  const startEditing = (providerId: CloudProviderId) => {
    const provider = CLOUD_PROVIDERS.find((p) => p.id === providerId);
    const defaults = getCloudProviderEditDefaults(provider, providerStatus()[providerId]);

    setEditingProvider(providerId);
    setApiKeyInput('');
    setIsProTier(defaults.isProTier);
    setSelectedModel(defaults.selectedModel);
    setError(null);
  };

  const cancelEditing = () => {
    setEditingProvider(null);
    setApiKeyInput('');
    setError(null);
  };

  const saveApiKey = async (providerId: CloudProviderId) => {
    const provider = getCloudProviderConfig(providerId);
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
      const response = await sendBackgroundMessageWithUiError({
        type: 'setCloudApiKey',
        provider: providerId,
        apiKey: key,
        options: {
          enabled: true,
          isPro: isProTier(),
          model: selectedModel(),
        },
      }, {
        setError,
        logger: log,
        userMessage: 'Failed to save API key',
        logMessage: 'Failed to save key:',
      });

      if (!response) {
        return;
      }

      if (!response.success) {
        setError(response.error ?? 'Failed to save API key');
        return;
      }

      setProviderStatus((prev) => ({
        ...prev,
        [providerId]: applySavedCloudProviderStatus(prev[providerId], provider, {
          enabled: true,
          isPro: isProTier(),
          model: selectedModel(),
        }),
      }));

      setEditingProvider(null);
    } catch (error) {
      reportUiError(setError, log, 'Failed to save API key', 'Failed to save key:', error);
    } finally {
      setSaving(false);
    }
  };

  const removeApiKey = async (providerId: CloudProviderId) => {
    const provider = getCloudProviderConfig(providerId);
    /* v8 ignore start -- guard: provider always found from own button handlers */
    if (!provider) return;
    /* v8 ignore stop */

    setConfirmRemove(null);
    try {
      const response = await sendBackgroundMessageWithUiError({
        type: 'clearCloudApiKey',
        provider: providerId,
      }, {
        setError,
        logger: log,
        userMessage: 'Failed to remove API key',
        logMessage: 'Failed to remove key:',
      });

      if (!response) {
        return;
      }

      if (!response.success) {
        setError(response.error ?? 'Failed to remove API key');
        return;
      }

      setProviderStatus((prev) => ({
        ...prev,
        [providerId]: createRemovedCloudProviderStatus(prev[providerId]),
      }));
    } catch (error) {
      log.error('Failed to remove key:', error);
    }
  };

  const toggleProvider = async (providerId: CloudProviderId) => {
    const provider = getCloudProviderConfig(providerId);
    const status = providerStatus()[providerId];
    /* v8 ignore start -- guard: toggle only rendered when hasKey is true */
    if (!provider || !status?.hasKey) return;
    /* v8 ignore stop */

    const newEnabled = !status.enabled;

    try {
      const response = await sendBackgroundMessageWithUiError({
        type: 'setCloudProviderEnabled',
        provider: providerId,
        enabled: newEnabled,
      }, {
        setError,
        logger: log,
        userMessage: 'Failed to update provider state',
        logMessage: 'Failed to toggle provider:',
      });

      if (!response) {
        return;
      }

      if (!response.success) {
        setError(response.error ?? 'Failed to update provider state');
        return;
      }

      setProviderStatus((prev) => ({
        ...prev,
        [providerId]: { ...prev[providerId], enabled: newEnabled },
      }));
    } catch (error) {
      log.error('Failed to toggle provider:', error);
    }
  };

  const testProvider = async (providerId: CloudProviderId) => {
    const provider = CLOUD_PROVIDERS.find((p) => p.id === providerId);
    /* v8 ignore start -- guard: provider always found from own button handlers */
    if (!provider) return;
    /* v8 ignore stop */

    setProviderStatus((prev) => ({
      ...prev,
      [providerId]: { ...prev[providerId], testing: true, testResult: null },
    }));

    try {
      const response = await sendBackgroundMessage<{ success?: boolean; message?: string }>({
        type: 'testProvider',
        provider: providerId,
      });

      setProviderStatus((prev) => ({
        ...prev,
        [providerId]: {
          ...prev[providerId],
          testing: false,
          testResult: response?.success ? 'success' : 'error',
          /* v8 ignore start -- fallback message when response lacks .message */
          testMessage: response?.message || (response?.success ? 'Connection successful' : 'Test failed'),
          /* v8 ignore stop */
        },
      }));

      // Clear result after 3 seconds
      setTimeout(() => {
        setProviderStatus((prev) => ({
          ...prev,
          [providerId]: { ...prev[providerId], testResult: null, testMessage: undefined },
        }));
      }, 3000);
    } catch (error) {
      log.error('Test failed:', error);
      setProviderStatus((prev) => ({
        ...prev,
        [providerId]: {
          ...prev[providerId],
          testing: false,
          testResult: 'error',
          /* v8 ignore start */
          testMessage: 'Test failed: ' + extractErrorMessage(error, 'Unknown error'),
          /* v8 ignore stop */
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
          const status = (): CloudProviderUiStatus =>
            providerStatus()[provider.id] || { hasKey: false, enabled: false };
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

      {/* v8 ignore start -- optional chaining + nullish coalescing */}
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
      {/* v8 ignore stop */}
    </div>
  );
};

/* v8 ignore start */
export default CloudProviders;
/* v8 ignore stop */
