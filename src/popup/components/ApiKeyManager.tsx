/**
 * API Key Manager Component
 * Manages API keys for cloud translation providers
 */

import { Component, For, Show } from 'solid-js';
import { ConfirmDialog } from '../../shared/ConfirmDialog';
import {
  CLOUD_PROVIDER_CONFIGS,
} from '../../shared/cloud-provider-configs';
import { createCloudProviderUiController } from '../../shared/cloud-provider-ui-controller';
import {
  type CloudProviderUiStatus,
} from '../../shared/cloud-provider-ui-state';

// Cloud provider definitions sourced from shared config

interface Props {
  onClose?: () => void;
}

export const ApiKeyManager: Component<Props> = (props) => {
  const {
    providerStatus,
    editingProvider,
    apiKeyInput,
    isProTier,
    saving,
    error,
    success,
    confirmRemove,
    setApiKeyInput,
    setIsProTier,
    setConfirmRemove,
    startEditing,
    cancelEditing,
    saveApiKey,
    removeApiKey,
  } = createCloudProviderUiController({
    providers: CLOUD_PROVIDER_CONFIGS,
    logName: 'ApiKeyManager',
    successMessageDurationMs: 1500,
  });

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
            const status = (): CloudProviderUiStatus =>
              providerStatus()[provider.id] || { hasKey: false, enabled: false };
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
