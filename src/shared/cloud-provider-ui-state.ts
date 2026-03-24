/**
 * Shared cloud provider UI state helpers for popup and options flows.
 */

import { safeStorageGet } from '../core/storage';
import type { CloudProviderId } from '../types';
import {
  buildValidatedCloudProviderMutation,
  extractCloudProviderConfigState,
} from './cloud-provider-config-state';
import {
  getCloudProviderStorageKeys,
  readStoredBoolean,
  type CloudProviderSettingsStorageMutation,
  type CloudProviderSettingsStorageRecord,
} from './cloud-provider-storage';
import { normalizeCloudProviderModelValue } from './provider-options';

export interface CloudProviderUiConfig {
  id: CloudProviderId;
  keyField: string;
  hasProTier: boolean;
  proField?: string;
  enabledField?: string;
  modelField?: string;
  models?: readonly string[];
  optionFields?: Readonly<Record<string, string>>;
}

export interface CloudProviderUiStatus {
  hasKey: boolean;
  enabled: boolean;
  isPro?: boolean;
  model?: string;
  testing?: boolean;
  testResult?: 'success' | 'error' | null;
  testMessage?: string;
}

export interface CloudProviderEditDefaults {
  isProTier: boolean;
  selectedModel: string;
}

export interface CloudProviderSaveOptions {
  enabled?: boolean;
  isPro?: boolean;
  model?: string;
}

export function buildCloudProviderUiStatusRecord(
  providers: readonly CloudProviderUiConfig[],
  stored: CloudProviderSettingsStorageRecord,
): Record<CloudProviderId, CloudProviderUiStatus> {
  const status = {} as Record<CloudProviderId, CloudProviderUiStatus>;

  for (const provider of providers) {
    const configState = extractCloudProviderConfigState(provider.id, stored);
    status[provider.id] = {
      hasKey: configState.hasKey,
      enabled: provider.enabledField
        ? (readStoredBoolean(stored, provider.enabledField) ?? false)
        : false,
      isPro: provider.hasProTier ? configState.isPro : undefined,
      model: provider.modelField ? configState.model : undefined,
    };
  }

  return status;
}

export async function loadCloudProviderUiStatus(
  providers: readonly CloudProviderUiConfig[],
): Promise<Record<CloudProviderId, CloudProviderUiStatus>> {
  const stored = await safeStorageGet<CloudProviderSettingsStorageRecord>(
    getCloudProviderStorageKeys(providers)
  );

  return buildCloudProviderUiStatusRecord(providers, stored);
}

export function getCloudProviderEditDefaults(
  provider: CloudProviderUiConfig | undefined,
  status?: CloudProviderUiStatus,
): CloudProviderEditDefaults {
  return {
    isProTier: status?.isPro ?? false,
    selectedModel: status?.model ?? provider?.models?.[0] ?? '',
  };
}

export function buildCloudProviderSaveMutation(
  provider: CloudProviderUiConfig,
  apiKey: string,
  options: CloudProviderSaveOptions = {},
): CloudProviderSettingsStorageMutation {
  const mutation: CloudProviderSettingsStorageMutation = {};
  mutation[provider.keyField as keyof CloudProviderSettingsStorageMutation] = apiKey;

  if (provider.enabledField && options.enabled !== undefined) {
    mutation[provider.enabledField as keyof CloudProviderSettingsStorageMutation] = options.enabled;
  }

  if (provider.optionFields) {
    Object.assign(
      mutation,
      buildValidatedCloudProviderMutation(provider.id, {
        isPro: options.isPro,
        model: options.model,
      }, provider.optionFields),
    );
  }

  return mutation;
}

export function applySavedCloudProviderStatus(
  previous: CloudProviderUiStatus | undefined,
  provider: CloudProviderUiConfig,
  options: CloudProviderSaveOptions = {},
): CloudProviderUiStatus {
  return {
    ...previous,
    hasKey: true,
    enabled: provider.enabledField ? (options.enabled ?? previous?.enabled ?? false) : false,
    isPro: provider.hasProTier ? (options.isPro ?? false) : undefined,
    model: provider.modelField
      ? normalizeCloudProviderModelValue(provider.id, options.model) ?? previous?.model
      : undefined,
  };
}

export function createRemovedCloudProviderStatus(
  previous?: CloudProviderUiStatus,
): CloudProviderUiStatus {
  return {
    ...previous,
    hasKey: false,
    enabled: false,
    isPro: undefined,
    model: undefined,
    testing: false,
    testResult: null,
    testMessage: undefined,
  };
}

export function getManagedCloudProviderKeys(provider: CloudProviderUiConfig): string[] {
  const keys = new Set<string>([provider.keyField]);

  if (provider.enabledField) {
    keys.add(provider.enabledField);
  }

  for (const optionKey of Object.values(provider.optionFields ?? {})) {
    keys.add(optionKey);
  }

  return [...keys];
}
