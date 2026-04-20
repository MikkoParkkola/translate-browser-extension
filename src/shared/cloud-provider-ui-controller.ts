import { createSignal, onMount } from 'solid-js';
import { createLogger } from '../core/logger';
import { extractErrorMessage } from '../core/errors';
import type { CloudProviderId } from '../types';
import {
  sendBackgroundMessage,
  sendBackgroundMessageWithUiError,
} from './background-message';
import {
  reportUiError,
  showTemporaryMessage,
} from './ui-feedback';
import type { CloudProviderConfig } from './cloud-provider-configs';
import { getCloudProviderConfig } from './cloud-provider-configs';
import {
  applySavedCloudProviderStatus,
  createRemovedCloudProviderStatus,
  getCloudProviderEditDefaults,
  loadCloudProviderUiStatus,
  type CloudProviderSaveOptions,
  type CloudProviderUiStatus,
} from './cloud-provider-ui-state';

export interface CreateCloudProviderUiControllerOptions {
  providers: readonly CloudProviderConfig[];
  logName: string;
  enableOnSave?: boolean;
  includeModelOption?: boolean;
  successMessageDurationMs?: number;
}

export function createCloudProviderUiController(
  options: CreateCloudProviderUiControllerOptions,
) {
  const log = createLogger(options.logName);

  const [providerStatus, setProviderStatus] = createSignal<Partial<Record<CloudProviderId, CloudProviderUiStatus>>>({});
  const [editingProvider, setEditingProvider] = createSignal<CloudProviderId | null>(null);
  const [apiKeyInput, setApiKeyInput] = createSignal('');
  const [isProTier, setIsProTier] = createSignal(false);
  const [selectedModel, setSelectedModel] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [success, setSuccess] = createSignal<string | null>(null);
  const [confirmRemove, setConfirmRemove] = createSignal<CloudProviderId | null>(null);

  const clearEditingState = () => {
    setEditingProvider(null);
    setApiKeyInput('');
    setIsProTier(false);
    setSelectedModel('');
  };

  const showSuccess = (message: string, onClear?: () => void) => {
    const durationMs = options.successMessageDurationMs ?? 0;
    if (durationMs > 0) {
      showTemporaryMessage(setSuccess, message, durationMs, onClear);
      return;
    }

    setSuccess(null);
    onClear?.();
  };

  const loadProviderStatus = async () => {
    try {
      setProviderStatus(await loadCloudProviderUiStatus(options.providers));
    } catch (error) {
      log.error('Failed to load status:', error);
      setProviderStatus({});
    }
  };

  onMount(async () => {
    await loadProviderStatus();
  });

  const startEditing = (providerId: CloudProviderId) => {
    const provider = options.providers.find((entry) => entry.id === providerId);
    const defaults = getCloudProviderEditDefaults(provider, providerStatus()[providerId]);

    setEditingProvider(providerId);
    setApiKeyInput('');
    setIsProTier(defaults.isProTier);
    setSelectedModel(defaults.selectedModel);
    setError(null);
    setSuccess(null);
  };

  const cancelEditing = () => {
    clearEditingState();
    setError(null);
    setSuccess(null);
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

    const saveOptions: CloudProviderSaveOptions = {
      isPro: isProTier(),
    };
    if (options.includeModelOption) {
      saveOptions.model = selectedModel();
    }
    if (options.enableOnSave && provider.enabledField) {
      saveOptions.enabled = true;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await sendBackgroundMessageWithUiError<{ success: boolean; error?: string }>({
        type: 'setCloudApiKey',
        provider: providerId,
        apiKey: key,
        options: saveOptions,
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
        [providerId]: applySavedCloudProviderStatus(prev[providerId], provider, saveOptions),
      }));

      showSuccess(`${provider.name} API key saved successfully`, () => {
        clearEditingState();
      });
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
      const response = await sendBackgroundMessageWithUiError<{ success: boolean; error?: string }>({
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

      showSuccess(`${provider.name} API key removed`);
    } catch (error) {
      reportUiError(setError, log, 'Failed to remove API key', 'Failed to remove key:', error);
    }
  };

  const toggleProvider = async (providerId: CloudProviderId) => {
    const status = providerStatus()[providerId];
    const provider = getCloudProviderConfig(providerId);
    /* v8 ignore start -- guard: toggle only rendered when the provider has a key */
    if (!provider || !status?.hasKey) return;
    /* v8 ignore stop */

    const newEnabled = !status.enabled;

    try {
      const response = await sendBackgroundMessageWithUiError<{ success: boolean; error?: string }>({
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
      reportUiError(setError, log, 'Failed to update provider state', 'Failed to toggle provider:', error);
    }
  };

  const testProvider = async (providerId: CloudProviderId) => {
    const provider = options.providers.find((entry) => entry.id === providerId);
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
          /* v8 ignore start -- fallback when response lacks .message */
          testMessage: response?.message || (response?.success ? 'Connection successful' : 'Test failed'),
          /* v8 ignore stop */
        },
      }));

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
          testMessage: `Test failed: ${extractErrorMessage(error, 'Unknown error')}`,
          /* v8 ignore stop */
        },
      }));
    }
  };

  return {
    providerStatus,
    editingProvider,
    apiKeyInput,
    isProTier,
    selectedModel,
    saving,
    error,
    success,
    confirmRemove,
    setApiKeyInput,
    setIsProTier,
    setSelectedModel,
    setConfirmRemove,
    loadProviderStatus,
    startEditing,
    cancelEditing,
    saveApiKey,
    removeApiKey,
    toggleProvider,
    testProvider,
  };
}
