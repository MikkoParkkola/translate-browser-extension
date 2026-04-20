import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOUD_PROVIDER_CONFIGS } from './cloud-provider-configs';
import { createCloudProviderUiController } from './cloud-provider-ui-controller';

const mockLogger = { error: vi.fn() };
const mockSendBackgroundMessage = vi.fn();
const mockSendBackgroundMessageWithUiError = vi.fn();
const mockReportUiError = vi.fn();
const mockShowTemporaryMessage = vi.fn();
const mockApplySavedCloudProviderStatus = vi.fn();
const mockCreateRemovedCloudProviderStatus = vi.fn();
const mockGetCloudProviderEditDefaults = vi.fn();
const mockLoadCloudProviderUiStatus = vi.fn();
const mockExtractErrorMessage = vi.fn();

vi.mock('../core/logger', () => ({
  createLogger: vi.fn(() => mockLogger),
}));

vi.mock('../core/errors', () => ({
  extractErrorMessage: (...args: unknown[]) => mockExtractErrorMessage(...args),
}));

vi.mock('./background-message', () => ({
  sendBackgroundMessage: (...args: unknown[]) => mockSendBackgroundMessage(...args),
  sendBackgroundMessageWithUiError: (...args: unknown[]) =>
    mockSendBackgroundMessageWithUiError(...args),
}));

vi.mock('./ui-feedback', () => ({
  reportUiError: (...args: unknown[]) => mockReportUiError(...args),
  showTemporaryMessage: (...args: unknown[]) => mockShowTemporaryMessage(...args),
}));

vi.mock('./cloud-provider-ui-state', () => ({
  applySavedCloudProviderStatus: (...args: unknown[]) => mockApplySavedCloudProviderStatus(...args),
  createRemovedCloudProviderStatus: (...args: unknown[]) => mockCreateRemovedCloudProviderStatus(...args),
  getCloudProviderEditDefaults: (...args: unknown[]) => mockGetCloudProviderEditDefaults(...args),
  loadCloudProviderUiStatus: (...args: unknown[]) => mockLoadCloudProviderUiStatus(...args),
}));

const deeplProvider = CLOUD_PROVIDER_CONFIGS.find((provider) => provider.id === 'deepl')!;
const openAiProvider = CLOUD_PROVIDER_CONFIGS.find((provider) => provider.id === 'openai')!;

function createController(overrides: Partial<Parameters<typeof createCloudProviderUiController>[0]> = {}) {
  return createRoot(() =>
    createCloudProviderUiController({
      providers: [deeplProvider, openAiProvider],
      logName: 'test-cloud-provider-ui',
      ...overrides,
    }),
  );
}

describe('createCloudProviderUiController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockLoadCloudProviderUiStatus.mockResolvedValue({});
    mockGetCloudProviderEditDefaults.mockReturnValue({
      isProTier: true,
      selectedModel: 'gpt-4o',
    });
    mockApplySavedCloudProviderStatus.mockImplementation((_previous, _provider, options) => ({
      hasKey: true,
      enabled: options.enabled ?? false,
      model: options.model,
      isPro: options.isPro,
    }));
    mockCreateRemovedCloudProviderStatus.mockImplementation(() => ({
      hasKey: false,
      enabled: false,
      testing: false,
      testResult: null,
    }));
    mockExtractErrorMessage.mockReturnValue('formatted failure');
    mockShowTemporaryMessage.mockImplementation((setter, message, _duration, onClear) => {
      setter(message);
      onClear?.();
    });
  });

  it('loads provider status and falls back to empty state on error', async () => {
    const controller = createController();

    mockLoadCloudProviderUiStatus.mockResolvedValueOnce({
      deepl: { hasKey: true, enabled: true },
    });
    await controller.loadProviderStatus();
    expect(controller.providerStatus()).toEqual({
      deepl: { hasKey: true, enabled: true },
    });

    mockLoadCloudProviderUiStatus.mockRejectedValueOnce(new Error('boom'));
    await controller.loadProviderStatus();
    expect(mockLogger.error).toHaveBeenCalledWith('Failed to load status:', expect.any(Error));
    expect(controller.providerStatus()).toEqual({});
  });

  it('starts and cancels editing using provider defaults', () => {
    const controller = createController();

    controller.startEditing('openai');

    expect(mockGetCloudProviderEditDefaults).toHaveBeenCalledWith(openAiProvider, undefined);
    expect(controller.editingProvider()).toBe('openai');
    expect(controller.isProTier()).toBe(true);
    expect(controller.selectedModel()).toBe('gpt-4o');

    controller.cancelEditing();

    expect(controller.editingProvider()).toBeNull();
    expect(controller.apiKeyInput()).toBe('');
    expect(controller.success()).toBeNull();
    expect(controller.error()).toBeNull();
  });

  it('rejects empty API keys before sending a save request', async () => {
    const controller = createController();

    await controller.saveApiKey('deepl');

    expect(controller.error()).toBe('Please enter an API key');
    expect(mockSendBackgroundMessageWithUiError).not.toHaveBeenCalled();
  });

  it('saves API keys, enables providers on save, and clears editing state on success', async () => {
    const controller = createController({
      includeModelOption: true,
      enableOnSave: true,
    });

    await controller.loadProviderStatus();
    controller.startEditing('openai');
    controller.setApiKeyInput(' openai-key ');
    controller.setSelectedModel('gpt-4o-mini');
    controller.setIsProTier(false);
    mockSendBackgroundMessageWithUiError.mockResolvedValueOnce({ success: true });

    await controller.saveApiKey('openai');

    expect(mockSendBackgroundMessageWithUiError).toHaveBeenCalledWith(
      {
        type: 'setCloudApiKey',
        provider: 'openai',
        apiKey: 'openai-key',
        options: { enabled: true, isPro: false, model: 'gpt-4o-mini' },
      },
      expect.objectContaining({
        userMessage: 'Failed to save API key',
      }),
    );
    expect(mockApplySavedCloudProviderStatus).toHaveBeenCalled();
    expect(controller.providerStatus().openai).toEqual({
      hasKey: true,
      enabled: true,
      model: 'gpt-4o-mini',
      isPro: false,
    });
    expect(controller.editingProvider()).toBeNull();
    expect(controller.saving()).toBe(false);
  });

  it('surfaces save failures from falsy and error responses', async () => {
    const controller = createController();
    controller.setApiKeyInput('deepl-key');

    mockSendBackgroundMessageWithUiError.mockResolvedValueOnce(null);
    await controller.saveApiKey('deepl');
    expect(controller.error()).toBeNull();

    mockSendBackgroundMessageWithUiError.mockResolvedValueOnce({
      success: false,
      error: 'bad key',
    });
    await controller.saveApiKey('deepl');
    expect(controller.error()).toBe('bad key');

    mockSendBackgroundMessageWithUiError.mockResolvedValueOnce({
      success: false,
    });
    await controller.saveApiKey('deepl');
    expect(controller.error()).toBe('Failed to save API key');

    mockSendBackgroundMessageWithUiError.mockRejectedValueOnce(new Error('network'));
    await controller.saveApiKey('deepl');
    expect(mockReportUiError).toHaveBeenCalledWith(
      expect.any(Function),
      mockLogger,
      'Failed to save API key',
      'Failed to save key:',
      expect.any(Error),
    );
    expect(controller.saving()).toBe(false);
  });

  it('removes API keys and can route success through temporary messages', async () => {
    const controller = createController({ successMessageDurationMs: 10 });

    mockLoadCloudProviderUiStatus.mockResolvedValueOnce({
      deepl: { hasKey: true, enabled: true },
    });
    await controller.loadProviderStatus();
    controller.setConfirmRemove('deepl');

    mockSendBackgroundMessageWithUiError.mockResolvedValueOnce({ success: true });
    await controller.removeApiKey('deepl');

    expect(controller.confirmRemove()).toBeNull();
    expect(mockCreateRemovedCloudProviderStatus).toHaveBeenCalledWith({
      hasKey: true,
      enabled: true,
    });
    expect(mockShowTemporaryMessage).toHaveBeenCalled();
    expect(controller.providerStatus().deepl).toEqual({
      hasKey: false,
      enabled: false,
      testing: false,
      testResult: null,
    });
  });

  it('handles null and thrown remove responses without mutating provider state', async () => {
    const controller = createController();
    mockLoadCloudProviderUiStatus.mockResolvedValueOnce({
      deepl: { hasKey: true, enabled: true },
    });
    await controller.loadProviderStatus();

    mockSendBackgroundMessageWithUiError.mockResolvedValueOnce(null);
    await controller.removeApiKey('deepl');
    expect(controller.providerStatus().deepl).toEqual({
      hasKey: true,
      enabled: true,
    });

    mockSendBackgroundMessageWithUiError.mockRejectedValueOnce(new Error('remove boom'));
    await controller.removeApiKey('deepl');
    expect(mockReportUiError).toHaveBeenCalledWith(
      expect.any(Function),
      mockLogger,
      'Failed to remove API key',
      'Failed to remove key:',
      expect.any(Error),
    );
  });

  it('surfaces remove and toggle failures', async () => {
    const controller = createController();
    mockLoadCloudProviderUiStatus.mockResolvedValueOnce({
      deepl: { hasKey: true, enabled: false },
    });
    await controller.loadProviderStatus();

    mockSendBackgroundMessageWithUiError.mockResolvedValueOnce({
      success: false,
      error: 'remove failed',
    });
    await controller.removeApiKey('deepl');
    expect(controller.error()).toBe('remove failed');

    mockSendBackgroundMessageWithUiError.mockResolvedValueOnce({
      success: false,
    });
    await controller.removeApiKey('deepl');
    expect(controller.error()).toBe('Failed to remove API key');

    mockSendBackgroundMessageWithUiError.mockResolvedValueOnce({
      success: false,
      error: 'toggle failed',
    });
    await controller.toggleProvider('deepl');
    expect(controller.error()).toBe('toggle failed');

    mockSendBackgroundMessageWithUiError.mockResolvedValueOnce({
      success: false,
    });
    await controller.toggleProvider('deepl');
    expect(controller.error()).toBe('Failed to update provider state');

    mockSendBackgroundMessageWithUiError.mockRejectedValueOnce(new Error('toggle boom'));
    await controller.toggleProvider('deepl');
    expect(mockReportUiError).toHaveBeenCalledWith(
      expect.any(Function),
      mockLogger,
      'Failed to update provider state',
      'Failed to toggle provider:',
      expect.any(Error),
    );
  });

  it('toggles providers when the background accepts the update', async () => {
    const controller = createController();
    mockLoadCloudProviderUiStatus.mockResolvedValueOnce({
      deepl: { hasKey: true, enabled: false },
    });
    await controller.loadProviderStatus();

    mockSendBackgroundMessageWithUiError.mockResolvedValueOnce({ success: true });
    await controller.toggleProvider('deepl');

    expect(mockSendBackgroundMessageWithUiError).toHaveBeenCalledWith(
      {
        type: 'setCloudProviderEnabled',
        provider: 'deepl',
        enabled: true,
      },
      expect.objectContaining({
        userMessage: 'Failed to update provider state',
      }),
    );
    expect(controller.providerStatus().deepl).toEqual({
      hasKey: true,
      enabled: true,
    });
  });

  it('tests providers, stores result messages, and clears transient status', async () => {
    const controller = createController();
    mockLoadCloudProviderUiStatus.mockResolvedValueOnce({
      deepl: { hasKey: true, enabled: true },
    });
    await controller.loadProviderStatus();

    mockSendBackgroundMessage.mockResolvedValueOnce({ success: true });
    await controller.testProvider('deepl');

    expect(controller.providerStatus().deepl).toEqual({
      hasKey: true,
      enabled: true,
      testing: false,
      testResult: 'success',
      testMessage: 'Connection successful',
    });

    vi.runAllTimers();
    expect(controller.providerStatus().deepl).toEqual({
      hasKey: true,
      enabled: true,
      testing: false,
      testResult: null,
      testMessage: undefined,
    });
  });

  it('records provider test failures with extracted messages', async () => {
    const controller = createController();
    mockLoadCloudProviderUiStatus.mockResolvedValueOnce({
      deepl: { hasKey: true, enabled: true },
    });
    await controller.loadProviderStatus();

    mockSendBackgroundMessage.mockRejectedValueOnce(new Error('provider down'));
    await controller.testProvider('deepl');

    expect(mockLogger.error).toHaveBeenCalledWith('Test failed:', expect.any(Error));
    expect(controller.providerStatus().deepl).toEqual({
      hasKey: true,
      enabled: true,
      testing: false,
      testResult: 'error',
      testMessage: 'Test failed: formatted failure',
    });
  });

  it('stores explicit failed provider test messages from the background', async () => {
    const controller = createController();
    mockLoadCloudProviderUiStatus.mockResolvedValueOnce({
      deepl: { hasKey: true, enabled: true },
    });
    await controller.loadProviderStatus();

    mockSendBackgroundMessage.mockResolvedValueOnce({
      success: false,
      message: 'Provider rejected credentials',
    });
    await controller.testProvider('deepl');

    expect(controller.providerStatus().deepl).toEqual({
      hasKey: true,
      enabled: true,
      testing: false,
      testResult: 'error',
      testMessage: 'Provider rejected credentials',
    });
  });
});
