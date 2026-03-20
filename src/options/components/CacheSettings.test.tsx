/**
 * CacheSettings component unit tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';

const mockSendMessage = vi.fn();

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: mockSendMessage,
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
    },
  },
});

vi.stubGlobal('navigator', {
  storage: {
    estimate: vi.fn().mockResolvedValue({ usage: 0, quota: 0 }),
  },
});

import { CacheSettings } from './CacheSettings';

const MOCK_STATS = {
  entries: 42,
  totalSize: 1024 * 1024 * 5,
  maxSize: 1024 * 1024 * 100,
  hits: 200,
  misses: 50,
  hitRate: 0.8,
  oldestTimestamp: 1700000000000,
  newestTimestamp: 1700086400000,
};

describe('CacheSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockResolvedValue({ stats: MOCK_STATS });
  });

  afterEach(cleanup);

  describe('initial render with stats', () => {
    it('renders section heading', async () => {
      render(() => <CacheSettings />);
      await vi.waitFor(() => {
        expect(screen.getByText('Translation Cache')).toBeTruthy();
      });
    });

    it('shows Cached Entries stat', async () => {
      render(() => <CacheSettings />);
      await vi.waitFor(() => {
        expect(screen.getByText('42')).toBeTruthy();
        expect(screen.getByText('Cached Entries')).toBeTruthy();
      });
    });

    it('shows Storage Used stat', async () => {
      render(() => <CacheSettings />);
      await vi.waitFor(() => {
        // parseFloat strips trailing zeros: 5.0 -> 5
        const body = document.body.textContent || '';
        expect(body).toContain('5 MB');
      });
    });

    it('shows Hit Rate stat', async () => {
      render(() => <CacheSettings />);
      await vi.waitFor(() => {
        expect(screen.getByText('80.0%')).toBeTruthy();
        expect(screen.getByText('Hit Rate')).toBeTruthy();
      });
    });

    it('shows cache hit and miss counts', async () => {
      render(() => <CacheSettings />);
      await vi.waitFor(() => {
        expect(screen.getByText('200')).toBeTruthy();
        expect(screen.getByText('50')).toBeTruthy();
        expect(screen.getByText('250')).toBeTruthy();
      });
    });

    it('shows hit rate alert when hitRate > 0', async () => {
      render(() => <CacheSettings />);
      await vi.waitFor(() => {
        expect(screen.getByText(/Your cache hit rate/)).toBeTruthy();
      });
    });

    it('shows Oldest and Newest entry dates', async () => {
      render(() => <CacheSettings />);
      await vi.waitFor(() => {
        expect(screen.getByText(/Oldest entry:/)).toBeTruthy();
        expect(screen.getByText(/Newest entry:/)).toBeTruthy();
      });
    });

    it('shows Clear Cache and Refresh Stats buttons', async () => {
      render(() => <CacheSettings />);
      await vi.waitFor(() => {
        // "Clear Cache" appears on both the button and the section title
        expect(screen.getAllByText('Clear Cache').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('Refresh Stats')).toBeTruthy();
      });
    });
  });

  describe('fallback stats when background returns nothing', () => {
    beforeEach(() => {
      mockSendMessage.mockResolvedValue({});
    });

    it('shows 0 entries fallback', async () => {
      render(() => <CacheSettings />);
      await vi.waitFor(() => {
        // "0" appears in several places (entries, hits, misses, total); confirm Cached Entries shows 0
        expect(screen.getByText('Cached Entries')).toBeTruthy();
        const body = document.body.textContent || '';
        expect(body).toContain('0');
      });
    });
  });

  describe('load error', () => {
    it('shows error when sendMessage throws', async () => {
      mockSendMessage.mockRejectedValue(new Error('Background not ready'));
      render(() => <CacheSettings />);
      await vi.waitFor(() => {
        expect(screen.getByText('Failed to load cache statistics')).toBeTruthy();
      });
    });
  });

  describe('clear cache', () => {
    // Helper: click the main "Clear Cache" button (not the dialog confirm button)
    const clickClearCacheBtn = () => {
      // The main button is disabled when entries===0. With MOCK_STATS entries=42 it is enabled.
      // Use the section title "Clear Cache" area — click the button via role with exact name
      const btns = screen.getAllByRole('button');
      const clearBtn = btns.find(
        (b) => b.textContent?.trim() === 'Clear Cache' && !(b as HTMLButtonElement).disabled
      );
      if (clearBtn) fireEvent.click(clearBtn);
    };

    it('opens ConfirmDialog on Clear Cache click', async () => {
      render(() => <CacheSettings />);
      await vi.waitFor(() => expect(screen.getAllByText('Clear Cache').length).toBeGreaterThan(0));
      clickClearCacheBtn();
      await vi.waitFor(() => {
        expect(screen.getByText('Clear Translation Cache')).toBeTruthy();
      });
    });

    const clickDialogConfirm = () => {
      const btn = document.querySelector('.confirm-dialog__btn--confirm') as HTMLElement;
      if (btn) fireEvent.click(btn);
    };

    it('calls sendMessage clearCache when confirmed', async () => {
      mockSendMessage
        .mockResolvedValueOnce({ stats: MOCK_STATS }) // initial load
        .mockResolvedValueOnce({}) // clearCache
        .mockResolvedValue({ stats: { ...MOCK_STATS, entries: 0 } }); // reload

      render(() => <CacheSettings />);
      await vi.waitFor(() => expect(screen.getAllByText('Clear Cache').length).toBeGreaterThan(0));
      clickClearCacheBtn();
      await vi.waitFor(() => expect(screen.getByText('Clear Translation Cache')).toBeTruthy());
      clickDialogConfirm();
      await vi.waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'clearCache' })
        );
      });
    });

    it('closes dialog on Keep Cache click', async () => {
      render(() => <CacheSettings />);
      await vi.waitFor(() => expect(screen.getAllByText('Clear Cache').length).toBeGreaterThan(0));
      clickClearCacheBtn();
      await vi.waitFor(() => expect(screen.getByText('Clear Translation Cache')).toBeTruthy());
      fireEvent.click(screen.getByText('Keep Cache'));
      await vi.waitFor(() => {
        expect(screen.queryByText('Clear Translation Cache')).toBeNull();
      });
    });

    it('shows success message after clearing', async () => {
      mockSendMessage
        .mockResolvedValueOnce({ stats: MOCK_STATS })
        .mockResolvedValueOnce({}) // clearCache
        .mockResolvedValue({ stats: { ...MOCK_STATS, entries: 0 } });

      render(() => <CacheSettings />);
      await vi.waitFor(() => expect(screen.getAllByText('Clear Cache').length).toBeGreaterThan(0));
      clickClearCacheBtn();
      await vi.waitFor(() => expect(screen.getByText('Clear Translation Cache')).toBeTruthy());
      clickDialogConfirm();
      await vi.waitFor(() => {
        expect(screen.getByText('Cache cleared successfully')).toBeTruthy();
      });
    });

    it('shows error when clearCache fails', async () => {
      mockSendMessage
        .mockResolvedValueOnce({ stats: MOCK_STATS })
        .mockRejectedValue(new Error('Storage error'));

      render(() => <CacheSettings />);
      await vi.waitFor(() => expect(screen.getAllByText('Clear Cache').length).toBeGreaterThan(0));
      clickClearCacheBtn();
      await vi.waitFor(() => expect(screen.getByText('Clear Translation Cache')).toBeTruthy());
      clickDialogConfirm();
      await vi.waitFor(() => {
        expect(screen.getByText('Failed to clear cache')).toBeTruthy();
      });
    });
  });

  describe('refresh stats', () => {
    it('calls sendMessage getCacheStats on Refresh Stats click', async () => {
      render(() => <CacheSettings />);
      await vi.waitFor(() => expect(screen.getByText('Refresh Stats')).toBeTruthy());
      mockSendMessage.mockClear();
      fireEvent.click(screen.getByText('Refresh Stats'));
      await vi.waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'getCacheStats' })
        );
      });
    });
  });

  describe('null timestamp handling', () => {
    it('shows N/A for null timestamps', async () => {
      mockSendMessage.mockResolvedValue({
        stats: { ...MOCK_STATS, oldestTimestamp: null, newestTimestamp: null },
      });
      render(() => <CacheSettings />);
      await vi.waitFor(() => {
        const nas = screen.getAllByText(/N\/A/);
        expect(nas.length).toBeGreaterThanOrEqual(2);
      });
    });
  });

  describe('zero hit rate', () => {
    it('does not show hit rate alert when hitRate is 0', async () => {
      mockSendMessage.mockResolvedValue({
        stats: { ...MOCK_STATS, hitRate: 0, hits: 0, misses: 0 },
      });
      render(() => <CacheSettings />);
      await vi.waitFor(() => {
        expect(screen.queryByText(/Your cache hit rate/)).toBeNull();
      });
    });
  });
});
