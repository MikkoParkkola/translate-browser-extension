/**
 * LocalModels component unit tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';

const mockSendMessage = vi.fn();
const mockStorageGet = vi.fn().mockResolvedValue({});

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: mockSendMessage,
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  storage: {
    local: {
      get: mockStorageGet,
      set: vi.fn().mockResolvedValue(undefined),
    },
  },
});

// Stub navigator.storage.estimate
const mockEstimate = vi.fn().mockResolvedValue({ usage: 0, quota: 0 });
Object.defineProperty(navigator, 'storage', {
  value: { estimate: mockEstimate },
  writable: true,
  configurable: true,
});

vi.stubGlobal('caches', {
  keys: vi.fn().mockResolvedValue([]),
  delete: vi.fn().mockResolvedValue(true),
});

import { LocalModels } from './LocalModels';

const MOCK_MODELS = [
  { id: 'opus-mt-en-fi', name: 'OPUS-MT English-Finnish', size: 314572800 },
  { id: 'opus-mt-fi-en', name: 'OPUS-MT Finnish-English', size: 314572800, lastUsed: 1700000000000 },
];

describe('LocalModels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageGet.mockResolvedValue({});
    mockSendMessage.mockResolvedValue({});
  });

  afterEach(cleanup);

  describe('initial render — empty state', () => {
    it('renders section title', async () => {
      render(() => <LocalModels />);
      await vi.waitFor(() => {
        expect(screen.getByText('Local Models')).toBeTruthy();
      });
    });

    it('shows Storage Usage section after loading', async () => {
      render(() => <LocalModels />);
      await vi.waitFor(() => {
        expect(screen.getByText('Storage Usage')).toBeTruthy();
      });
    });

    it('shows "No models downloaded yet" when no models', async () => {
      render(() => <LocalModels />);
      await vi.waitFor(() => {
        expect(screen.getByText('No models downloaded yet')).toBeTruthy();
      });
    });

    it('shows Clear All Models button', async () => {
      render(() => <LocalModels />);
      await vi.waitFor(() => {
        expect(screen.getByText('Clear All Models')).toBeTruthy();
      });
    });

    it('shows About Local Models section', async () => {
      render(() => <LocalModels />);
      await vi.waitFor(() => {
        expect(screen.getByText('About Local Models')).toBeTruthy();
      });
    });
  });

  describe('with models from background', () => {
    beforeEach(() => {
      mockSendMessage.mockResolvedValue({ models: MOCK_MODELS });
      mockEstimate.mockResolvedValue({
        usage: 629145600,
        quota: 10 * 1024 * 1024 * 1024,
      });
    });

    it('renders model names', async () => {
      render(() => <LocalModels />);
      await vi.waitFor(() => {
        expect(screen.getByText('OPUS-MT English-Finnish')).toBeTruthy();
        expect(screen.getByText('OPUS-MT Finnish-English')).toBeTruthy();
      });
    });

    it('shows formatted model size', async () => {
      render(() => <LocalModels />);
      await vi.waitFor(() => {
        // parseFloat strips trailing zeros: 300.0 -> 300
        const body = document.body.textContent || '';
        expect(body).toContain('300 MB');
      });
    });

    it('shows last used date when available', async () => {
      render(() => <LocalModels />);
      await vi.waitFor(() => {
        expect(screen.getByText(/Last used:/)).toBeTruthy();
      });
    });

    it('shows Delete button per model', async () => {
      render(() => <LocalModels />);
      await vi.waitFor(() => {
        const deleteBtns = screen.getAllByText('Delete');
        expect(deleteBtns.length).toBe(2);
      });
    });
  });

  describe('with models from storage fallback', () => {
    beforeEach(() => {
      // Background returns nothing
      mockSendMessage.mockResolvedValue({});
      mockStorageGet.mockResolvedValue({
        downloadedModels: [
          { id: 'opus-mt-en-de', name: 'OPUS-MT English-German', size: 314572800 },
        ],
      });
    });

    it('falls back to storage models', async () => {
      render(() => <LocalModels />);
      await vi.waitFor(() => {
        expect(screen.getByText('OPUS-MT English-German')).toBeTruthy();
      });
    });
  });

  describe('delete model', () => {
    beforeEach(() => {
      mockSendMessage.mockResolvedValue({ models: MOCK_MODELS });
    });

    it('calls sendMessage with deleteModel when confirmed', async () => {
      vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
      mockSendMessage
        .mockResolvedValueOnce({ models: MOCK_MODELS }) // initial load
        .mockResolvedValueOnce({}) // deleteModel
        .mockResolvedValue({}); // reload

      render(() => <LocalModels />);
      await vi.waitFor(() => expect(screen.getAllByText('Delete').length).toBe(2));
      fireEvent.click(screen.getAllByText('Delete')[0]);
      await vi.waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'deleteModel' })
        );
      });
    });

    it('does not call deleteModel when confirm cancelled', async () => {
      vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));
      render(() => <LocalModels />);
      await vi.waitFor(() => expect(screen.getAllByText('Delete').length).toBe(2));
      // Reset call count after initial load
      mockSendMessage.mockClear();
      fireEvent.click(screen.getAllByText('Delete')[0]);
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('shows alert on delete failure', async () => {
      vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
      vi.stubGlobal('alert', vi.fn());
      mockSendMessage
        .mockResolvedValueOnce({ models: MOCK_MODELS })
        .mockRejectedValue(new Error('Cannot delete'));

      render(() => <LocalModels />);
      await vi.waitFor(() => expect(screen.getAllByText('Delete').length).toBe(2));
      fireEvent.click(screen.getAllByText('Delete')[0]);
      await vi.waitFor(() => {
        expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Failed to delete'));
      });
    });
  });

  describe('clear all models', () => {
    beforeEach(() => {
      mockSendMessage.mockResolvedValue({ models: MOCK_MODELS });
    });

    it('calls sendMessage clearAllModels when confirmed', async () => {
      vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
      mockSendMessage
        .mockResolvedValueOnce({ models: MOCK_MODELS })
        .mockResolvedValueOnce({}) // clearAllModels
        .mockResolvedValue({});

      render(() => <LocalModels />);
      await vi.waitFor(() => expect(screen.getByText('Clear All Models')).toBeTruthy());
      fireEvent.click(screen.getByText('Clear All Models'));
      await vi.waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'clearAllModels' })
        );
      });
    });

    it('does not call clearAllModels when confirm cancelled', async () => {
      vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));
      render(() => <LocalModels />);
      await vi.waitFor(() => expect(screen.getByText('Clear All Models')).toBeTruthy());
      mockSendMessage.mockClear();
      fireEvent.click(screen.getByText('Clear All Models'));
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('shows alert on clear failure', async () => {
      vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
      vi.stubGlobal('alert', vi.fn());
      mockSendMessage
        .mockResolvedValueOnce({ models: MOCK_MODELS })
        .mockRejectedValue(new Error('Cannot clear'));

      render(() => <LocalModels />);
      await vi.waitFor(() => expect(screen.getByText('Clear All Models')).toBeTruthy());
      fireEvent.click(screen.getByText('Clear All Models'));
      await vi.waitFor(() => {
        expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Failed to clear'));
      });
    });
  });

  describe('storage usage display', () => {
    it('shows 0 B used when no storage data', async () => {
      // Ensure estimate returns zeros
      mockEstimate.mockResolvedValueOnce({ usage: 0, quota: 0 });
      mockSendMessage.mockResolvedValueOnce({}); // no models from background
      render(() => <LocalModels />);
      await vi.waitFor(() => {
        // "0 B" is rendered in a <span> alongside other text
        const body = document.body.textContent || '';
        expect(body).toContain('0 B');
      });
    });

    it('shows progress bar with correct class for high usage', async () => {
      mockEstimate.mockResolvedValueOnce({
        usage: 90 * 1024 * 1024,
        quota: 100 * 1024 * 1024,
      });
      mockSendMessage.mockResolvedValue({});

      render(() => <LocalModels />);
      await vi.waitFor(() => {
        const dangerBar = document.querySelector('.progress-fill.danger');
        expect(dangerBar).toBeTruthy();
      });
    });
  });
});
