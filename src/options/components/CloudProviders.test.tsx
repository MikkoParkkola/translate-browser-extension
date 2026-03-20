/**
 * CloudProviders component unit tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';

const mockStorageGet = vi.fn().mockResolvedValue({});
const mockStorageSet = vi.fn().mockResolvedValue(undefined);
const mockStorageRemove = vi.fn().mockResolvedValue(undefined);
const mockSendMessage = vi.fn().mockResolvedValue({});

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: mockSendMessage,
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  storage: {
    local: {
      get: mockStorageGet,
      set: mockStorageSet,
      remove: mockStorageRemove,
    },
  },
});

import { CloudProviders } from './CloudProviders';

describe('CloudProviders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageGet.mockResolvedValue({});
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
      mockStorageSet.mockResolvedValue(undefined);
      render(() => <CloudProviders />);
      await vi.waitFor(() => expect(screen.getAllByText('Add API Key').length).toBe(4));
      fireEvent.click(screen.getAllByText('Add API Key')[0]);
      await vi.waitFor(() => expect(screen.getByPlaceholderText(/xxxxxxxx/)).toBeTruthy());
      const input = screen.getByPlaceholderText(/xxxxxxxx/);
      fireEvent.input(input, { target: { value: 'test-api-key' } });
      fireEvent.click(screen.getByText('Save'));
      await vi.waitFor(() => {
        expect(mockStorageSet).toHaveBeenCalled();
        expect(screen.queryByText('Please enter an API key')).toBeNull();
      });
    });

    it('shows error when storage.set throws', async () => {
      mockStorageSet.mockRejectedValue(new Error('quota exceeded'));
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

    it('calls storage.set to toggle on Disable click', async () => {
      render(() => <CloudProviders />);
      await vi.waitFor(() => expect(screen.getByText('Disable')).toBeTruthy());
      fireEvent.click(screen.getByText('Disable'));
      await vi.waitFor(() => {
        expect(mockStorageSet).toHaveBeenCalledWith({ deepl_enabled: false });
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

    it('calls storage.remove when confirmed', async () => {
      render(() => <CloudProviders />);
      await vi.waitFor(() => expect(screen.getByText('Remove')).toBeTruthy());
      fireEvent.click(screen.getByText('Remove'));
      await vi.waitFor(() => expect(screen.getByText('Remove API Key')).toBeTruthy());
      // Click the confirm button inside the dialog (has confirm-specific class)
      const confirmBtn = document.querySelector('.confirm-dialog__btn--confirm') as HTMLElement;
      if (confirmBtn) fireEvent.click(confirmBtn);
      await vi.waitFor(() => {
        expect(mockStorageRemove).toHaveBeenCalled();
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
  });
});
