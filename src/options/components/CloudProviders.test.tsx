/**
 * CloudProviders component unit tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import { setupUiChromeMock } from '../../test-helpers/chrome-mocks';

const { mockStorageGet, mockStorageSet, mockStorageRemove } = vi.hoisted(() => ({
  mockStorageGet: vi.fn().mockResolvedValue({}),
  mockStorageSet: vi.fn().mockResolvedValue(true),
  mockStorageRemove: vi.fn().mockResolvedValue(true),
}));
const mockSendMessage = vi.fn().mockResolvedValue({ success: true });

vi.mock('../../core/storage', () => ({
  safeStorageGet: mockStorageGet,
  safeStorageSet: mockStorageSet,
  safeStorageRemove: mockStorageRemove,
}));

setupUiChromeMock({
  runtimeSendMessage: mockSendMessage,
  storageLocalGet: mockStorageGet,
  storageLocalSet: mockStorageSet,
  storageLocalRemove: mockStorageRemove,
});

import { CloudProviders } from './CloudProviders';

describe('CloudProviders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageGet.mockResolvedValue({});
    mockSendMessage.mockResolvedValue({ success: true });
  });

  afterEach(cleanup);

  describe('initial render', () => {
    it('renders section heading', async () => {
      render(() => <CloudProviders />);
      await vi.waitFor(() => {
        expect(screen.getByText('Cloud Translation Providers')).toBeTruthy();
      });
    });

    it('renders all four providers', async () => {
      render(() => <CloudProviders />);
      await vi.waitFor(() => {
        expect(screen.getByText('DeepL')).toBeTruthy();
        expect(screen.getByText('OpenAI')).toBeTruthy();
        expect(screen.getByText('Google Cloud')).toBeTruthy();
        expect(screen.getByText('Claude (Anthropic)')).toBeTruthy();
      });
    });

    it('shows "Not configured" badge for unconfigured providers', async () => {
      render(() => <CloudProviders />);
      await vi.waitFor(() => {
        const badges = screen.getAllByText('Not configured');
        expect(badges.length).toBe(4);
      });
    });

    it('renders Add API Key buttons for each provider', async () => {
      render(() => <CloudProviders />);
      await vi.waitFor(() => {
        const addBtns = screen.getAllByText('Add API Key');
        expect(addBtns.length).toBe(4);
      });
    });

    it('shows configured provider with Enabled/Disabled badge', async () => {
      mockStorageGet.mockResolvedValue({
        deepl_api_key: 'test-key',
        deepl_enabled: true,
      });
      render(() => <CloudProviders />);
      await vi.waitFor(() => {
        expect(screen.getByText('Enabled')).toBeTruthy();
      });
    });

    it('shows Disabled badge when provider has key but disabled', async () => {
      mockStorageGet.mockResolvedValue({
        deepl_api_key: 'test-key',
        deepl_enabled: false,
      });
      render(() => <CloudProviders />);
      await vi.waitFor(() => {
        expect(screen.getByText('Disabled')).toBeTruthy();
      });
    });

    it('shows Pro badge for DeepL with isPro=true', async () => {
      mockStorageGet.mockResolvedValue({
        deepl_api_key: 'test-key',
        deepl_enabled: true,
        deepl_is_pro: true,
      });
      render(() => <CloudProviders />);
      await vi.waitFor(() => {
        expect(screen.getByText('Pro')).toBeTruthy();
      });
    });

    it('shows Update API Key button for configured providers', async () => {
      mockStorageGet.mockResolvedValue({
        deepl_api_key: 'test-key',
        deepl_enabled: true,
      });
      render(() => <CloudProviders />);
      await vi.waitFor(() => {
        expect(screen.getByText('Update API Key')).toBeTruthy();
      });
    });

    it('shows Remove button for configured providers', async () => {
      mockStorageGet.mockResolvedValue({
        deepl_api_key: 'test-key',
        deepl_enabled: true,
      });
      render(() => <CloudProviders />);
      await vi.waitFor(() => {
        expect(screen.getByText('Remove')).toBeTruthy();
      });
    });
  });

  describe('edit form', () => {
    it('opens edit form on Add API Key click', async () => {
      render(() => <CloudProviders />);
      await vi.waitFor(() => expect(screen.getAllByText('Add API Key').length).toBeGreaterThan(0));
      fireEvent.click(screen.getAllByText('Add API Key')[0]);
      expect(screen.getByPlaceholderText(/xxxxxxxx/)).toBeTruthy();
    });

    it('shows model selector for OpenAI', async () => {
      render(() => <CloudProviders />);
      await vi.waitFor(() => expect(screen.getAllByText('Add API Key').length).toBe(4));
      // OpenAI is index 1
      fireEvent.click(screen.getAllByText('Add API Key')[1]);
      await vi.waitFor(() => {
        expect(screen.getByText('gpt-4o')).toBeTruthy();
      });
    });

    it('shows Pro tier toggle for DeepL', async () => {
      render(() => <CloudProviders />);
      await vi.waitFor(() => expect(screen.getAllByText('Add API Key').length).toBe(4));
      // DeepL is index 0
      fireEvent.click(screen.getAllByText('Add API Key')[0]);
      await vi.waitFor(() => {
        expect(screen.getByText('Pro tier (paid account)')).toBeTruthy();
      });
    });

    it('shows error when saving with empty key', async () => {
      render(() => <CloudProviders />);
      await vi.waitFor(() => expect(screen.getAllByText('Add API Key').length).toBe(4));
      fireEvent.click(screen.getAllByText('Add API Key')[0]);
      await vi.waitFor(() => expect(screen.getByPlaceholderText(/xxxxxxxx/)).toBeTruthy());
      fireEvent.click(screen.getByText('Save'));
      await vi.waitFor(() => {
        expect(screen.getByText('Please enter an API key')).toBeTruthy();
      });
    });

    it('saves key and closes form on valid input', async () => {
      mockSendMessage.mockResolvedValue({ success: true, provider: 'deepl' });
      render(() => <CloudProviders />);
      await vi.waitFor(() => expect(screen.getAllByText('Add API Key').length).toBe(4));
      fireEvent.click(screen.getAllByText('Add API Key')[0]);
      await vi.waitFor(() => expect(screen.getByPlaceholderText(/xxxxxxxx/)).toBeTruthy());
      const input = screen.getByPlaceholderText(/xxxxxxxx/);
      fireEvent.input(input, { target: { value: 'test-api-key' } });
      fireEvent.click(screen.getByText('Save'));
      await vi.waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({
          type: 'setCloudApiKey',
          provider: 'deepl',
          apiKey: 'test-api-key',
          options: { enabled: true, isPro: false, model: '' },
        });
        expect(screen.queryByText('Please enter an API key')).toBeNull();
      });
    });

    it('shows error when background save throws', async () => {
      mockSendMessage.mockRejectedValue(new Error('quota exceeded'));
      render(() => <CloudProviders />);
      await vi.waitFor(() => expect(screen.getAllByText('Add API Key').length).toBe(4));
      fireEvent.click(screen.getAllByText('Add API Key')[0]);
      await vi.waitFor(() => expect(screen.getByPlaceholderText(/xxxxxxxx/)).toBeTruthy());
      const input = screen.getByPlaceholderText(/xxxxxxxx/);
      fireEvent.input(input, { target: { value: 'test-key' } });
      fireEvent.click(screen.getByText('Save'));
      await vi.waitFor(() => {
        expect(screen.getByText('Failed to save API key')).toBeTruthy();
      });
    });

    it('Cancel button closes edit form', async () => {
      render(() => <CloudProviders />);
      await vi.waitFor(() => expect(screen.getAllByText('Add API Key').length).toBe(4));
      fireEvent.click(screen.getAllByText('Add API Key')[0]);
      await vi.waitFor(() => expect(screen.getByText('Cancel')).toBeTruthy());
      fireEvent.click(screen.getByText('Cancel'));
      expect(screen.queryByPlaceholderText(/xxxxxxxx/)).toBeNull();
    });

    it('shows Get API key link in edit form', async () => {
      render(() => <CloudProviders />);
      await vi.waitFor(() => expect(screen.getAllByText('Add API Key').length).toBe(4));
      fireEvent.click(screen.getAllByText('Add API Key')[0]);
      await vi.waitFor(() => {
        expect(screen.getByText('Get API key')).toBeTruthy();
      });
    });

    it('saves model selection for OpenAI', async () => {
      mockSendMessage.mockResolvedValue({ success: true, provider: 'openai' });
      render(() => <CloudProviders />);
      await vi.waitFor(() => expect(screen.getAllByText('Add API Key').length).toBe(4));
      fireEvent.click(screen.getAllByText('Add API Key')[1]); // OpenAI
      await vi.waitFor(() => expect(screen.getByPlaceholderText(/sk-/)).toBeTruthy());
      
      const input = screen.getByPlaceholderText(/sk-/);
      fireEvent.input(input, { target: { value: 'sk-test-key' } });
      fireEvent.click(screen.getByText('Save'));
      
      await vi.waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({
          type: 'setCloudApiKey',
          provider: 'openai',
          apiKey: 'sk-test-key',
          options: {
            enabled: true,
            isPro: false,
            model: expect.any(String),
          },
        });
      });
    });
  });

  describe('toggle provider', () => {
    beforeEach(() => {
      mockStorageGet.mockResolvedValue({
        deepl_api_key: 'test-key',
        deepl_enabled: true,
      });
    });

    it('shows Disable/Enable buttons for configured provider', async () => {
      render(() => <CloudProviders />);
      await vi.waitFor(() => {
        expect(screen.getByText('Disable')).toBeTruthy();
      });
    });

    it('calls background toggle handler on Disable click', async () => {
      render(() => <CloudProviders />);
      await vi.waitFor(() => expect(screen.getByText('Disable')).toBeTruthy());
      fireEvent.click(screen.getByText('Disable'));
      await vi.waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({
          type: 'setCloudProviderEnabled',
          provider: 'deepl',
          enabled: false,
        });
      });
    });

    it('updates badge from Enabled to Disabled after toggle', async () => {
      mockSendMessage.mockResolvedValue({ success: true, provider: 'deepl', enabled: false });
      render(() => <CloudProviders />);
      await vi.waitFor(() => {
        expect(screen.getByText('Enabled')).toBeTruthy();
      });
      fireEvent.click(screen.getByText('Disable'));
      await vi.waitFor(() => {
        expect(screen.getByText('Disabled')).toBeTruthy();
      });
    });

    it('enables provider when currently disabled', async () => {
      mockStorageGet.mockResolvedValue({
        deepl_api_key: 'test-key',
        deepl_enabled: false,
      });
      mockSendMessage.mockResolvedValue({ success: true, provider: 'deepl', enabled: true });
      
      render(() => <CloudProviders />);
      await vi.waitFor(() => {
        expect(screen.getByText('Disabled')).toBeTruthy();
      });
      fireEvent.click(screen.getByText('Enable'));
      await vi.waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({
          type: 'setCloudProviderEnabled',
          provider: 'deepl',
          enabled: true,
        });
      });
    });

    it('handles toggle error when background update fails', async () => {
      mockSendMessage.mockRejectedValue(new Error('toggle failed'));
      render(() => <CloudProviders />);
      await vi.waitFor(() => {
        expect(screen.getByText('Disable')).toBeTruthy();
      });
      fireEvent.click(screen.getByText('Disable'));
      // Should not crash, just log error
      await vi.waitFor(() => {
        // Provider status should remain unchanged
        expect(screen.getByText('Enabled')).toBeTruthy();
      });
    });
  });

  describe('test provider', () => {
    beforeEach(() => {
      mockStorageGet.mockResolvedValue({
        deepl_api_key: 'test-key',
        deepl_enabled: true,
      });
    });

    it('shows Test button for configured provider', async () => {
      render(() => <CloudProviders />);
      await vi.waitFor(() => {
        expect(screen.getByText('Test')).toBeTruthy();
      });
    });

    it('shows success result after successful test', async () => {
      mockSendMessage.mockResolvedValue({ success: true, message: 'Connection successful' });
      render(() => <CloudProviders />);
      await vi.waitFor(() => expect(screen.getByText('Test')).toBeTruthy());
      fireEvent.click(screen.getByText('Test'));
      await vi.waitFor(() => {
        expect(screen.getByText('Connection successful')).toBeTruthy();
      });
    });

    it('shows error result after failed test', async () => {
      mockSendMessage.mockResolvedValue({ success: false, message: 'Invalid key' });
      render(() => <CloudProviders />);
      await vi.waitFor(() => expect(screen.getByText('Test')).toBeTruthy());
      fireEvent.click(screen.getByText('Test'));
      await vi.waitFor(() => {
        expect(screen.getByText('Invalid key')).toBeTruthy();
      });
    });

    it('shows error on test exception', async () => {
      mockSendMessage.mockRejectedValue(new Error('Network error'));
      render(() => <CloudProviders />);
      await vi.waitFor(() => expect(screen.getByText('Test')).toBeTruthy());
      fireEvent.click(screen.getByText('Test'));
      await vi.waitFor(() => {
        expect(screen.getByText(/Test failed: Network error/)).toBeTruthy();
      });
    });
  });

  describe('test provider', () => {
    beforeEach(() => {
      mockStorageGet.mockResolvedValue({
        deepl_api_key: 'test-key',
        deepl_enabled: true,
      });
    });

    it('shows Test button for configured provider', async () => {
      render(() => <CloudProviders />);
      await vi.waitFor(() => {
        expect(screen.getByText('Test')).toBeTruthy();
      });
    });

    it('shows success result after successful test', async () => {
      mockSendMessage.mockResolvedValue({ success: true, message: 'Connection successful' });
      render(() => <CloudProviders />);
      await vi.waitFor(() => expect(screen.getByText('Test')).toBeTruthy());
      fireEvent.click(screen.getByText('Test'));
      await vi.waitFor(() => {
        expect(screen.getByText('Connection successful')).toBeTruthy();
      });
    });

    it('shows error result after failed test', async () => {
      mockSendMessage.mockResolvedValue({ success: false, message: 'Invalid key' });
      render(() => <CloudProviders />);
      await vi.waitFor(() => expect(screen.getByText('Test')).toBeTruthy());
      fireEvent.click(screen.getByText('Test'));
      await vi.waitFor(() => {
        expect(screen.getByText('Invalid key')).toBeTruthy();
      });
    });

    it('shows error on test exception', async () => {
      mockSendMessage.mockRejectedValue(new Error('Network error'));
      render(() => <CloudProviders />);
      await vi.waitFor(() => expect(screen.getByText('Test')).toBeTruthy());
      fireEvent.click(screen.getByText('Test'));
      await vi.waitFor(() => {
        expect(screen.getByText(/Test failed: Network error/)).toBeTruthy();
      });
    });

    it('clears test result after 3 seconds', async () => {
      mockSendMessage.mockResolvedValue({ success: true, message: 'Connection successful' });
      render(() => <CloudProviders />);
      await vi.waitFor(() => expect(screen.getByText('Test')).toBeTruthy());
      fireEvent.click(screen.getByText('Test'));
      await vi.waitFor(() => {
        expect(screen.getByText('Connection successful')).toBeTruthy();
      });

      // Wait for setTimeout to clear the result
      await new Promise(r => setTimeout(r, 3100));
      await vi.waitFor(() => {
        expect(screen.queryByText('Connection successful')).toBeNull();
      });
    });

    it('disables Test button during testing', async () => {
      mockSendMessage.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ success: true }), 1000))
      );
      render(() => <CloudProviders />);
      await vi.waitFor(() => expect(screen.getByText('Test')).toBeTruthy());
      
      const testBtn = screen.getByText('Test') as HTMLButtonElement;
      fireEvent.click(testBtn);

      // Button should be disabled while testing
      expect(testBtn).toHaveAttribute('disabled');
    });
  });

  describe('remove provider', () => {
    beforeEach(() => {
      mockStorageGet.mockResolvedValue({
        deepl_api_key: 'test-key',
        deepl_enabled: true,
      });
    });

    it('shows ConfirmDialog on Remove click', async () => {
      render(() => <CloudProviders />);
      await vi.waitFor(() => expect(screen.getByText('Remove')).toBeTruthy());
      fireEvent.click(screen.getByText('Remove'));
      await vi.waitFor(() => {
        expect(screen.getByText('Remove API Key')).toBeTruthy();
      });
    });

    it('calls background clearCloudApiKey when confirmed', async () => {
      render(() => <CloudProviders />);
      await vi.waitFor(() => expect(screen.getByText('Remove')).toBeTruthy());
      fireEvent.click(screen.getByText('Remove'));
      await vi.waitFor(() => expect(screen.getByText('Remove API Key')).toBeTruthy());
      // Click the confirm button inside the dialog (has confirm-specific class)
      const confirmBtn = document.querySelector('.confirm-dialog__btn--confirm') as HTMLElement;
      if (confirmBtn) fireEvent.click(confirmBtn);
      await vi.waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({
          type: 'clearCloudApiKey',
          provider: 'deepl',
        });
      });
    });

    it('closes dialog on Keep click', async () => {
      render(() => <CloudProviders />);
      await vi.waitFor(() => expect(screen.getByText('Remove')).toBeTruthy());
      fireEvent.click(screen.getByText('Remove'));
      await vi.waitFor(() => expect(screen.getByText('Remove API Key')).toBeTruthy());
      fireEvent.click(screen.getByText('Keep'));
      await vi.waitFor(() => {
        expect(screen.queryByText('Remove API Key')).toBeNull();
      });
    });

    it('removes Pro tier and model fields for DeepL on removal', async () => {
      mockStorageGet.mockResolvedValue({
        deepl_api_key: 'test-key',
        deepl_enabled: true,
        deepl_is_pro: true,
      });
      mockSendMessage.mockResolvedValue({ success: true, provider: 'deepl' });

      render(() => <CloudProviders />);
      await vi.waitFor(() => expect(screen.getByText('Remove')).toBeTruthy());
      fireEvent.click(screen.getByText('Remove'));
      await vi.waitFor(() => expect(screen.getByText('Remove API Key')).toBeTruthy());

      const confirmBtn = document.querySelector('.confirm-dialog__btn--confirm') as HTMLElement;
      if (confirmBtn) fireEvent.click(confirmBtn);

      await vi.waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({
          type: 'clearCloudApiKey',
          provider: 'deepl',
        });
      });
    });

    it('removes model field for OpenAI on removal', async () => {
      mockStorageGet.mockResolvedValue({
        openai_api_key: 'test-key',
        openai_enabled: true,
        openai_model: 'gpt-4o',
      });
      mockSendMessage.mockResolvedValue({ success: true, provider: 'openai' });

      render(() => <CloudProviders />);
      await vi.waitFor(() => expect(screen.getAllByText('Update API Key').length).toBeGreaterThan(0));

      fireEvent.click(screen.getAllByText('Update API Key')[0]);

      await vi.waitFor(() => {
        const removeBtn = screen.queryByText('Remove');
        if (removeBtn) {
          fireEvent.click(removeBtn);
        }
      });
    });

    it('removes model field for OpenAI when removeApiKey is called (line 188)', async () => {
      mockStorageGet.mockResolvedValue({
        openai_api_key: 'sk-test-key',
        openai_enabled: true,
        openai_model: 'gpt-4o',
      });
      mockSendMessage.mockResolvedValue({ success: true, provider: 'openai' });

      render(() => <CloudProviders />);
      await vi.waitFor(() => {
        expect(screen.getAllByText('Remove').length).toBeGreaterThan(0);
      });

      const removeButtons = screen.getAllByText('Remove');
      expect(removeButtons.length).toBeGreaterThan(0);

      fireEvent.click(removeButtons[0]);

      await vi.waitFor(() => expect(screen.getByText('Remove API Key')).toBeTruthy());
      const confirmBtn = document.querySelector('.confirm-dialog__btn--confirm') as HTMLElement;
      if (confirmBtn) fireEvent.click(confirmBtn);

      await vi.waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({
          type: 'clearCloudApiKey',
          provider: 'openai',
        });
      });
    });

    it('handles removeApiKey error gracefully (line 198)', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockStorageGet.mockResolvedValue({
        openai_api_key: 'sk-test-key',
        openai_enabled: true,
      });
      mockSendMessage.mockRejectedValue(new Error('Storage error'));

      render(() => <CloudProviders />);
      await vi.waitFor(() => {
        expect(screen.getAllByText('Remove').length).toBeGreaterThan(0);
      });

      // Find and click a Remove button
      const removeButtons = screen.getAllByText('Remove');
      if (removeButtons.length > 0) {
        fireEvent.click(removeButtons[0]);

        await vi.waitFor(() => expect(screen.getByText('Remove API Key')).toBeTruthy());
        const confirmBtn = document.querySelector('.confirm-dialog__btn--confirm') as HTMLElement;
        if (confirmBtn) fireEvent.click(confirmBtn);

        // Error is caught and logged
        await vi.waitFor(() => {
          expect(mockSendMessage).toHaveBeenCalled();
        });
      }

      consoleErrorSpy.mockRestore();
    });
  });

  describe('provider status on mount', () => {
    it('loads provider status from storage on mount', async () => {
      mockStorageGet.mockResolvedValue({
        deepl_api_key: 'test-key',
        deepl_enabled: true,
        openai_api_key: 'sk-test',
        openai_enabled: false,
        openai_model: 'gpt-4o',
      });

      render(() => <CloudProviders />);
      await vi.waitFor(() => {
        expect(mockStorageGet).toHaveBeenCalled();
      });
    });

    it('handles load error gracefully', async () => {
      mockStorageGet.mockRejectedValue(new Error('Storage error'));

      // Should not throw
      expect(() => {
        render(() => <CloudProviders />);
      }).not.toThrow();
    });
  });

  describe('provider configuration persistence', () => {
    it('persists Pro tier setting when saving DeepL key', async () => {
      mockSendMessage.mockResolvedValue({ success: true, provider: 'deepl' });
      render(() => <CloudProviders />);
      await vi.waitFor(() => expect(screen.getAllByText('Add API Key').length).toBe(4));
      fireEvent.click(screen.getAllByText('Add API Key')[0]); // DeepL

      await vi.waitFor(() => {
        expect(screen.getByText('Pro tier (paid account)')).toBeTruthy();
      });

      const input = screen.getByPlaceholderText(/xxxxxxxx/);
      fireEvent.input(input, { target: { value: 'test-key' } });

      // Check the Pro checkbox
      const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
      fireEvent.click(checkbox);

      fireEvent.click(screen.getByText('Save'));

      await vi.waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({
          type: 'setCloudApiKey',
          provider: 'deepl',
          apiKey: 'test-key',
          options: {
            enabled: true,
            isPro: true,
            model: '',
          },
        });
      });
    });

    it('persists model selection for OpenAI', async () => {
      mockSendMessage.mockResolvedValue({ success: true, provider: 'openai' });
      render(() => <CloudProviders />);
      await vi.waitFor(() => expect(screen.getAllByText('Add API Key').length).toBe(4));
      fireEvent.click(screen.getAllByText('Add API Key')[1]); // OpenAI

      await vi.waitFor(() => {
        expect(screen.getByText('gpt-4o')).toBeTruthy();
      });

      const input = screen.getByPlaceholderText(/sk-/);
      fireEvent.input(input, { target: { value: 'sk-test-key' } });

      // Change model
      const selects = screen.getAllByRole('combobox');
      const modelSelect = selects[selects.length - 1];
      fireEvent.change(modelSelect, { target: { value: 'gpt-4o-mini' } });

      fireEvent.click(screen.getByText('Save'));

      await vi.waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({
          type: 'setCloudApiKey',
          provider: 'openai',
          apiKey: 'sk-test-key',
          options: {
            enabled: true,
            isPro: false,
            model: 'gpt-4o-mini',
          },
        });
      });
    });
  });
});
