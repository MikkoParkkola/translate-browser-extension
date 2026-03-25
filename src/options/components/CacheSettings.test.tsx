/**
 * CacheSettings component unit tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import { setupUiChromeMock } from '../../test-helpers/chrome-mocks';

const mockSendMessage = vi.fn();

setupUiChromeMock({
  runtimeSendMessage: mockSendMessage,
});

import { CacheSettings } from './CacheSettings';

const MOCK_STATS = {
  size: 42,
  maxSize: 1000,
  hitRate: '200/250 (80%)',
  oldestEntry: 1700000000000,
  totalHits: 200,
  totalMisses: 50,
  mostUsed: [],
  memoryEstimate: '~5120KB',
  languagePairs: { 'en-fi': 40, 'en-sv': 2 },
};

describe('CacheSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockResolvedValue({ cache: MOCK_STATS });
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

    it('shows Estimated Memory stat', async () => {
      render(() => <CacheSettings />);
      await vi.waitFor(() => {
        const body = document.body.textContent || '';
        expect(body).toContain('~5120KB');
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
        expect(screen.getByText(/Your cache served/)).toBeTruthy();
      });
    });

    it('shows Oldest entry and language pair count', async () => {
      render(() => <CacheSettings />);
      await vi.waitFor(() => {
        expect(screen.getByText(/Oldest entry:/)).toBeTruthy();
        expect(screen.getByText(/Language pairs:/)).toBeTruthy();
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
        expect(body).toContain('~0KB');
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
        .mockResolvedValueOnce({ cache: MOCK_STATS }) // initial load
        .mockResolvedValueOnce({}) // clearCache
        .mockResolvedValue({
          cache: {
            ...MOCK_STATS,
            size: 0,
            totalHits: 0,
            totalMisses: 0,
            hitRate: '0/0 (0%)',
            memoryEstimate: '~0KB',
            languagePairs: {},
          },
        }); // reload

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
        .mockResolvedValueOnce({ cache: MOCK_STATS })
        .mockResolvedValueOnce({}) // clearCache
        .mockResolvedValue({
          cache: {
            ...MOCK_STATS,
            size: 0,
            totalHits: 0,
            totalMisses: 0,
            hitRate: '0/0 (0%)',
            memoryEstimate: '~0KB',
            languagePairs: {},
          },
        });

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
        .mockResolvedValueOnce({ cache: MOCK_STATS })
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
        cache: { ...MOCK_STATS, oldestEntry: null },
      });
      render(() => <CacheSettings />);
      await vi.waitFor(() => {
        const nas = screen.getAllByText(/N\/A/);
        expect(nas.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('zero hit rate', () => {
    it('does not show hit rate alert when hitRate is 0', async () => {
      mockSendMessage.mockResolvedValue({
        cache: { ...MOCK_STATS, hitRate: '0/0 (0%)', totalHits: 0, totalMisses: 0 },
      });
      render(() => <CacheSettings />);
      await vi.waitFor(() => {
        expect(screen.queryByText(/Your cache served/)).toBeNull();
      });
    });
  });

  describe('progress bar styling', () => {
    it('shows danger class for high usage >80%', async () => {
      mockSendMessage.mockResolvedValue({
        cache: { ...MOCK_STATS, size: 900, maxSize: 1000 },
      });
      render(() => <CacheSettings />);
      await vi.waitFor(() => {
        const progressFill = document.querySelector('.progress-fill');
        expect(progressFill?.className).toContain('danger');
      });
    });

    it('shows warning class for medium usage 50-80%', async () => {
      mockSendMessage.mockResolvedValue({
        cache: { ...MOCK_STATS, size: 600, maxSize: 1000 },
      });
      render(() => <CacheSettings />);
      await vi.waitFor(() => {
        const progressFill = document.querySelector('.progress-fill');
        expect(progressFill?.className).toContain('warning');
      });
    });

    it('shows no class for low usage <50%', async () => {
      mockSendMessage.mockResolvedValue({
        cache: { ...MOCK_STATS, size: 300, maxSize: 1000 },
      });
      render(() => <CacheSettings />);
      await vi.waitFor(() => {
        const progressFill = document.querySelector('.progress-fill');
        expect(progressFill?.className).not.toContain('danger');
        expect(progressFill?.className).not.toContain('warning');
      });
    });
  });
});
