/**
 * ApiKeyManager component unit tests
 *
 * Tests the API key management UI for cloud translation providers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';

// Chrome API mock
vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: vi.fn().mockResolvedValue({}),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    openOptionsPage: vi.fn(),
  },
  storage: {
    local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) },
  },
  tabs: {
    query: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn().mockResolvedValue({}),
  },
  scripting: { executeScript: vi.fn().mockResolvedValue(undefined) },
});

// Mock ConfirmDialog — use a Solid-reactive wrapper so props.open changes re-render
vi.mock('../../shared/ConfirmDialog', () => ({
  ConfirmDialog: (props: any) => <>{() => props.open ? <div data-testid="confirm-dialog">{props.message}</div> : null}</>,
}));

import { ApiKeyManager } from './ApiKeyManager';

describe('ApiKeyManager', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    // Default: no keys stored
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  // -----------------------------------------------------------------------
  // Export / basic render
  // -----------------------------------------------------------------------

  it('exports ApiKeyManager as a function component', () => {
    expect(typeof ApiKeyManager).toBe('function');
  });

  it('renders the title "Cloud Translation Providers"', async () => {
    render(() => <ApiKeyManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('Cloud Translation Providers')).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // Provider entries
  // -----------------------------------------------------------------------

  it('shows 4 provider entries (DeepL, OpenAI, Google Cloud, Claude)', async () => {
    render(() => <ApiKeyManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('DeepL')).toBeTruthy();
      expect(screen.getByText('OpenAI')).toBeTruthy();
      expect(screen.getByText('Google Cloud')).toBeTruthy();
      expect(screen.getByText('Claude')).toBeTruthy();
    });
  });

  it('shows "Not configured" for providers without keys', async () => {
    render(() => <ApiKeyManager />);
    await vi.waitFor(() => {
      const badges = screen.getAllByText('Not configured');
      expect(badges.length).toBe(4);
    });
  });

  it('shows "Configured" for providers with keys', async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      deepl_api_key: 'test-key-1',
      openai_api_key: 'test-key-2',
      google_cloud_api_key: 'test-key-3',
      anthropic_api_key: 'test-key-4',
    });

    render(() => <ApiKeyManager />);
    await vi.waitFor(() => {
      const configured = screen.getAllByText('Configured');
      expect(configured.length).toBe(4);
    });
  });

  // -----------------------------------------------------------------------
  // Buttons per state
  // -----------------------------------------------------------------------

  it('shows "Add" button for unconfigured providers', async () => {
    render(() => <ApiKeyManager />);
    await vi.waitFor(() => {
      const addButtons = screen.getAllByText('Add');
      expect(addButtons.length).toBe(4);
    });
  });

  it('shows "Update" and "Remove" buttons for configured providers', async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      deepl_api_key: 'key-deepl',
      openai_api_key: 'key-openai',
      google_cloud_api_key: 'key-google',
      anthropic_api_key: 'key-anthropic',
    });

    render(() => <ApiKeyManager />);
    await vi.waitFor(() => {
      const updateButtons = screen.getAllByText('Update');
      expect(updateButtons.length).toBe(4);
      const removeButtons = screen.getAllByText('Remove');
      expect(removeButtons.length).toBe(4);
    });
  });

  // -----------------------------------------------------------------------
  // Add / Edit form
  // -----------------------------------------------------------------------

  it('clicking "Add" shows the API key form with password input', async () => {
    const { container } = render(() => <ApiKeyManager />);
    await vi.waitFor(() => {
      expect(screen.getAllByText('Add').length).toBe(4);
    });

    // Click the first "Add" button (DeepL)
    const addButtons = screen.getAllByText('Add');
    fireEvent.click(addButtons[0]);

    await vi.waitFor(() => {
      const passwordInput = container.querySelector('input[type="password"]');
      expect(passwordInput).toBeTruthy();
    });
  });

  it('clicking "Cancel" hides the form', async () => {
    const { container } = render(() => <ApiKeyManager />);
    await vi.waitFor(() => {
      expect(screen.getAllByText('Add').length).toBe(4);
    });

    // Open form
    fireEvent.click(screen.getAllByText('Add')[0]);
    await vi.waitFor(() => {
      expect(container.querySelector('input[type="password"]')).toBeTruthy();
    });

    // Click Cancel
    fireEvent.click(screen.getByText('Cancel'));
    await vi.waitFor(() => {
      expect(container.querySelector('input[type="password"]')).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------------

  it('shows error when saving empty key', async () => {
    render(() => <ApiKeyManager />);
    await vi.waitFor(() => {
      expect(screen.getAllByText('Add').length).toBe(4);
    });

    // Open form for DeepL
    fireEvent.click(screen.getAllByText('Add')[0]);
    await vi.waitFor(() => {
      expect(screen.getByText('Save')).toBeTruthy();
    });

    // Click Save without entering a key
    fireEvent.click(screen.getByText('Save'));

    await vi.waitFor(() => {
      expect(screen.getByText('Please enter an API key')).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // Save flow
  // -----------------------------------------------------------------------

  it('calls chrome.storage.local.set when saving a valid key', async () => {
    const { container } = render(() => <ApiKeyManager />);
    await vi.waitFor(() => {
      expect(screen.getAllByText('Add').length).toBe(4);
    });

    // Open form for DeepL
    fireEvent.click(screen.getAllByText('Add')[0]);
    await vi.waitFor(() => {
      expect(screen.getByText('Save')).toBeTruthy();
    });

    // Type a key
    const input = container.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'my-test-api-key' } });

    // Save
    fireEvent.click(screen.getByText('Save'));

    await vi.waitFor(() => {
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({ deepl_api_key: 'my-test-api-key' }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // Close button
  // -----------------------------------------------------------------------

  it('close button calls onClose prop', async () => {
    const onClose = vi.fn();
    render(() => <ApiKeyManager onClose={onClose} />);
    await vi.waitFor(() => {
      expect(screen.getByLabelText('Close')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  // -----------------------------------------------------------------------
  // DeepL Pro tier toggle
  // -----------------------------------------------------------------------

  it('DeepL provider has Pro tier toggle', async () => {
    const { container } = render(() => <ApiKeyManager />);
    await vi.waitFor(() => {
      expect(screen.getAllByText('Add').length).toBe(4);
    });

    // Open form for DeepL (first provider)
    fireEvent.click(screen.getAllByText('Add')[0]);
    await vi.waitFor(() => {
      expect(screen.getByText('Pro tier (paid account)')).toBeTruthy();
    });

    // Verify it's a checkbox
    const proCheckbox = container.querySelector('label.api-key-pro-toggle input[type="checkbox"]');
    expect(proCheckbox).toBeTruthy();
  });

  it('Pro tier toggle is not shown for non-DeepL providers', async () => {
    render(() => <ApiKeyManager />);
    await vi.waitFor(() => {
      expect(screen.getAllByText('Add').length).toBe(4);
    });

    // Open form for OpenAI (second provider)
    fireEvent.click(screen.getAllByText('Add')[1]);
    await vi.waitFor(() => {
      expect(screen.getByText('Save')).toBeTruthy();
    });
    expect(screen.queryByText('Pro tier (paid account)')).toBeNull();
  });

  it('saves Pro tier flag together with DeepL key', async () => {
    const { container } = render(() => <ApiKeyManager />);
    await vi.waitFor(() => {
      expect(screen.getAllByText('Add').length).toBe(4);
    });

    // Open form for DeepL
    fireEvent.click(screen.getAllByText('Add')[0]);
    await vi.waitFor(() => {
      expect(screen.getByText('Save')).toBeTruthy();
    });

    // Type a key
    const input = container.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'deepl-pro-key' } });

    // Check the Pro toggle
    const proCheckbox = container.querySelector('label.api-key-pro-toggle input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(proCheckbox);

    // Save
    fireEvent.click(screen.getByText('Save'));

    await vi.waitFor(() => {
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          deepl_api_key: 'deepl-pro-key',
          deepl_is_pro: true,
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // Remove flow
  // -----------------------------------------------------------------------

  it('clicking Remove shows the ConfirmDialog', async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      deepl_api_key: 'existing-key',
    });

    render(() => <ApiKeyManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('Remove')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Remove'));

    await vi.waitFor(() => {
      expect(screen.getByTestId('confirm-dialog')).toBeTruthy();
    });
  });

  it('shows "Pro" status for DeepL with Pro tier enabled', async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      deepl_api_key: 'pro-key',
      deepl_is_pro: true,
    });

    render(() => <ApiKeyManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('Pro')).toBeTruthy();
    });
  });
});
