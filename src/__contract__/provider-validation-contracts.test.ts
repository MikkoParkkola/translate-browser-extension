import { expect } from 'vitest';
import { AnthropicProvider } from '../providers/anthropic';
import { DeepLProvider } from '../providers/deepl';
import { GoogleCloudProvider } from '../providers/google-cloud';
import { OpenAIProvider } from '../providers/openai';
import {
  defineCloudProviderLifecycleContract,
  inspectCloudProvider,
  installCloudProviderTestHarness,
} from './cloud-provider-test-harness';

const { mockStorage, resetStorage, storageLocal } = installCloudProviderTestHarness();

defineCloudProviderLifecycleContract({
  name: 'Anthropic',
  create: () => inspectCloudProvider(new AnthropicProvider()),
  mockStorage,
  resetStorage,
  storageLocal,
  apiKeyKey: 'anthropic_api_key',
  expectedInfo: {
    id: 'anthropic',
    name: 'Claude',
    type: 'cloud',
    qualityTier: 'premium',
    costPerMillion: 3000,
  },
  seedConfiguredStorage(storage) {
    storage['anthropic_api_key'] = 'sk-ant-test';
    storage['anthropic_model'] = 'claude-sonnet-4-20250514';
    storage['anthropic_formality'] = 'formal';
    storage['anthropic_tokens_used'] = 100;
  },
  assertLoadedInfo(info) {
    expect(info.model).toBe('claude-sonnet-4-20250514');
    expect(info.formality).toBe('formal');
  },
  async configure(provider) {
    await provider.setApiKey('sk-ant-test');
  },
  assertConfiguredStorage(storage) {
    expect(storage['anthropic_api_key']).toBe('sk-ant-test');
  },
  assertConfiguredInfo(info) {
    expect(info.model).toBe('claude-3-5-haiku-20241022');
    expect(info.formality).toBe('neutral');
  },
  async reconfigure(provider) {
    await provider.setModel('claude-sonnet-4-20250514');
    await provider.setFormality('formal');
    await provider.setApiKey('sk-ant-rotated');
  },
  assertReconfiguredInfo(info, storage) {
    expect(storage['anthropic_api_key']).toBe('sk-ant-rotated');
    expect(info.model).toBe('claude-sonnet-4-20250514');
    expect(info.formality).toBe('formal');
  },
});

defineCloudProviderLifecycleContract({
  name: 'OpenAI',
  create: () => inspectCloudProvider(new OpenAIProvider()),
  mockStorage,
  resetStorage,
  storageLocal,
  apiKeyKey: 'openai_api_key',
  expectedInfo: {
    id: 'openai',
    name: 'OpenAI',
    type: 'cloud',
    qualityTier: 'premium',
    costPerMillion: 5000,
  },
  seedConfiguredStorage(storage) {
    storage['openai_api_key'] = 'sk-openai-test';
    storage['openai_model'] = 'gpt-4o';
    storage['openai_formality'] = 'formal';
    storage['openai_temperature'] = 0.3;
    storage['openai_tokens_used'] = 100;
  },
  assertLoadedInfo(info) {
    expect(info.model).toBe('gpt-4o');
    expect(info.formality).toBe('formal');
  },
  async configure(provider) {
    await provider.setApiKey('sk-openai-test');
  },
  assertConfiguredStorage(storage) {
    expect(storage['openai_api_key']).toBe('sk-openai-test');
  },
  assertConfiguredInfo(info) {
    expect(info.model).toBe('gpt-4o-mini');
    expect(info.formality).toBe('neutral');
  },
  async reconfigure(provider) {
    await provider.setModel('gpt-4o');
    await provider.setFormality('formal');
    await provider.setApiKey('sk-openai-rotated');
  },
  assertReconfiguredInfo(info, storage) {
    expect(storage['openai_api_key']).toBe('sk-openai-rotated');
    expect(info.model).toBe('gpt-4o');
    expect(info.formality).toBe('formal');
  },
});

defineCloudProviderLifecycleContract({
  name: 'DeepL',
  create: () => inspectCloudProvider(new DeepLProvider()),
  mockStorage,
  resetStorage,
  storageLocal,
  apiKeyKey: 'deepl_api_key',
  expectedInfo: {
    id: 'deepl',
    name: 'DeepL',
    type: 'cloud',
    qualityTier: 'premium',
    costPerMillion: 20,
  },
  seedConfiguredStorage(storage) {
    storage['deepl_api_key'] = 'deepl-test-key';
    storage['deepl_is_pro'] = true;
    storage['deepl_formality'] = 'more';
  },
  assertLoadedInfo(info) {
    expect(info.tier).toBe('Pro');
    expect(info.formality).toBe('more');
  },
  async configure(provider) {
    await provider.setApiKey('deepl-test-key', false);
  },
  assertConfiguredStorage(storage) {
    expect(storage['deepl_api_key']).toBe('deepl-test-key');
    expect(storage['deepl_is_pro']).toBe(false);
  },
  assertConfiguredInfo(info) {
    expect(info.tier).toBe('Free');
    expect(info.formality).toBe('default');
  },
  async reconfigure(provider) {
    await provider.setFormality('prefer_more');
    await provider.setApiKey('deepl-pro-key', true);
  },
  assertReconfiguredInfo(info, storage) {
    expect(storage['deepl_api_key']).toBe('deepl-pro-key');
    expect(storage['deepl_is_pro']).toBe(true);
    expect(info.tier).toBe('Pro');
    expect(info.formality).toBe('prefer_more');
  },
});

defineCloudProviderLifecycleContract({
  name: 'Google Cloud',
  create: () => inspectCloudProvider(new GoogleCloudProvider()),
  mockStorage,
  resetStorage,
  storageLocal,
  apiKeyKey: 'google_cloud_api_key',
  expectedInfo: {
    id: 'google-cloud',
    name: 'Google Cloud Translation',
    type: 'cloud',
    qualityTier: 'standard',
    costPerMillion: 20,
  },
  seedConfiguredStorage(storage) {
    storage['google_cloud_api_key'] = 'AIza-test-key';
    storage['google_cloud_chars_used'] = 1000;
  },
  assertLoadedInfo(info) {
    expect(info.charactersUsed).toBe(1000);
  },
  async configure(provider) {
    await provider.setApiKey('AIza-test-key');
  },
  assertConfiguredStorage(storage) {
    expect(storage['google_cloud_api_key']).toBe('AIza-test-key');
  },
});
