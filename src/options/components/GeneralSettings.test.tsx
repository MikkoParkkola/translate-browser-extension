/**
 * GeneralSettings component unit tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: vi.fn().mockResolvedValue({}),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
    },
  },
});

vi.mock('../../core/storage', () => ({
  safeStorageGet: vi.fn().mockResolvedValue({}),
  safeStorageSet: vi.fn().mockResolvedValue(true),
  lastStorageError: null,
}));

import { GeneralSettings } from './GeneralSettings';
import { safeStorageGet, safeStorageSet } from '../../core/storage';

describe('GeneralSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageSet as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  });

  afterEach(cleanup);

  describe('initial render', () => {
    it('renders section heading', async () => {
      render(() => <GeneralSettings />);
      await vi.waitFor(() => {
        expect(screen.getByText('General Settings')).toBeTruthy();
      });
    });

    it('renders Source Language and Target Language selects', async () => {
      render(() => <GeneralSettings />);
      await vi.waitFor(() => {
        expect(screen.getByText('Source Language')).toBeTruthy();
        expect(screen.getByText('Target Language')).toBeTruthy();
      });
    });

    it('renders Strategy section', async () => {
      render(() => <GeneralSettings />);
      await vi.waitFor(() => {
        expect(screen.getByText('Translation Strategy')).toBeTruthy();
      });
    });

    it('renders auto-translate toggle', async () => {
      render(() => <GeneralSettings />);
      await vi.waitFor(() => {
        expect(screen.getByText('Auto-translate pages')).toBeTruthy();
      });
    });

    it('renders Save Settings button', async () => {
      render(() => <GeneralSettings />);
      await vi.waitFor(() => {
        expect(screen.getByText('Save Settings')).toBeTruthy();
      });
    });

    it('calls safeStorageGet on mount to load settings', async () => {
      render(() => <GeneralSettings />);
      await vi.waitFor(() => {
        expect(safeStorageGet).toHaveBeenCalledWith(['sourceLang', 'targetLang', 'strategy', 'autoTranslate']);
      });
    });

    it('populates values from stored settings', async () => {
      (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({
        sourceLang: 'fi',
        targetLang: 'en',
        strategy: 'fast',
        autoTranslate: true,
      });
      render(() => <GeneralSettings />);
      await vi.waitFor(() => {
        const sourceSelect = screen.getByDisplayValue('Finnish');
        expect(sourceSelect).toBeTruthy();
      });
    });
  });

  describe('save settings', () => {
    it('calls safeStorageSet on Save click', async () => {
      render(() => <GeneralSettings />);
      await vi.waitFor(() => expect(screen.getByText('Save Settings')).toBeTruthy());
      fireEvent.click(screen.getByText('Save Settings'));
      await vi.waitFor(() => {
        expect(safeStorageSet).toHaveBeenCalledWith(
          expect.objectContaining({
            sourceLang: 'auto',
            targetLang: 'en',
            strategy: 'smart',
          })
        );
      });
    });

    it('shows Saved! after successful save', async () => {
      render(() => <GeneralSettings />);
      await vi.waitFor(() => expect(screen.getByText('Save Settings')).toBeTruthy());
      fireEvent.click(screen.getByText('Save Settings'));
      await vi.waitFor(() => {
        expect(screen.getByText('Saved!')).toBeTruthy();
      });
    });

    it('shows error message when save fails', async () => {
      (safeStorageSet as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      // Set lastStorageError via module mock
      vi.doMock('../../core/storage', () => ({
        safeStorageGet: vi.fn().mockResolvedValue({}),
        safeStorageSet: vi.fn().mockResolvedValue(false),
        lastStorageError: 'Quota exceeded',
      }));

      render(() => <GeneralSettings />);
      await vi.waitFor(() => expect(screen.getByText('Save Settings')).toBeTruthy());
      fireEvent.click(screen.getByText('Save Settings'));
      await vi.waitFor(() => {
        // Either "Quota exceeded" or the fallback "Failed to save settings."
        const errorEl = document.querySelector('[style*="color: rgb(220, 38, 38)"]') ||
          document.querySelector('[style*="#dc2626"]');
        expect(errorEl || screen.queryByText(/Failed to save|Quota/)).toBeTruthy();
      });
    });

    it('updates source language on select change', async () => {
      render(() => <GeneralSettings />);
      await vi.waitFor(() => expect(screen.getByText('Save Settings')).toBeTruthy());
      const sourceSelect = screen.getByDisplayValue('Auto Detect');
      fireEvent.change(sourceSelect, { target: { value: 'de' } });
      fireEvent.click(screen.getByText('Save Settings'));
      await vi.waitFor(() => {
        expect(safeStorageSet).toHaveBeenCalledWith(
          expect.objectContaining({ sourceLang: 'de' })
        );
      });
    });

    it('updates target language on select change', async () => {
      render(() => <GeneralSettings />);
      await vi.waitFor(() => expect(screen.getByText('Save Settings')).toBeTruthy());
      const targetSelect = screen.getByDisplayValue('English');
      fireEvent.change(targetSelect, { target: { value: 'fi' } });
      fireEvent.click(screen.getByText('Save Settings'));
      await vi.waitFor(() => {
        expect(safeStorageSet).toHaveBeenCalledWith(
          expect.objectContaining({ targetLang: 'fi' })
        );
      });
    });

    it('toggles autoTranslate on checkbox change', async () => {
      render(() => <GeneralSettings />);
      await vi.waitFor(() => expect(screen.getByText('Save Settings')).toBeTruthy());
      const checkbox = screen.getByRole('checkbox');
      fireEvent.change(checkbox, { target: { checked: true } });
      fireEvent.click(screen.getByText('Save Settings'));
      await vi.waitFor(() => {
        expect(safeStorageSet).toHaveBeenCalledWith(
          expect.objectContaining({ autoTranslate: true })
        );
      });
    });
  });
});
