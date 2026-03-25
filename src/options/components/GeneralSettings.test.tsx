/**
 * GeneralSettings component unit tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import { setupUiChromeMock } from '../../test-helpers/chrome-mocks';

setupUiChromeMock();

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

  describe('branch coverage — partial storage data', () => {
    it('keeps defaults when storage returns empty object', async () => {
      (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({});
      render(() => <GeneralSettings />);
      await vi.waitFor(() => expect(screen.getByText('Save Settings')).toBeTruthy());
      // Source lang should default to 'Auto Detect', target to 'English'
      expect(screen.getByDisplayValue('Auto Detect')).toBeTruthy();
      expect(screen.getByDisplayValue('English')).toBeTruthy();
    });

    it('applies only sourceLang when only sourceLang is stored', async () => {
      (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({
        sourceLang: 'de',
      });
      render(() => <GeneralSettings />);
      await vi.waitFor(() => {
        expect(screen.getByDisplayValue('German')).toBeTruthy();
      });
      // Target should remain default 'English'
      expect(screen.getByDisplayValue('English')).toBeTruthy();
    });

    it('applies only targetLang when only targetLang is stored', async () => {
      (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({
        targetLang: 'fi',
      });
      render(() => <GeneralSettings />);
      await vi.waitFor(() => {
        expect(screen.getByDisplayValue('Finnish')).toBeTruthy();
      });
      // Source should remain default 'Auto Detect'
      expect(screen.getByDisplayValue('Auto Detect')).toBeTruthy();
    });

    it('applies only strategy when only strategy is stored', async () => {
      (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({
        strategy: 'quality',
      });
      render(() => <GeneralSettings />);
      await vi.waitFor(() => expect(screen.getByText('Save Settings')).toBeTruthy());
      fireEvent.click(screen.getByText('Save Settings'));
      await vi.waitFor(() => {
        expect(safeStorageSet).toHaveBeenCalledWith(
          expect.objectContaining({ strategy: 'quality' })
        );
      });
    });

    it('does not set autoTranslate when it is absent from storage', async () => {
      (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({
        sourceLang: 'en',
      });
      render(() => <GeneralSettings />);
      await vi.waitFor(() => expect(screen.getByText('Save Settings')).toBeTruthy());
      const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
      // Default is false (unchecked)
      expect(checkbox.checked).toBe(false);
    });
  });

  describe('branch coverage — button text states', () => {
    it('shows "Save Settings" before any interaction', async () => {
      render(() => <GeneralSettings />);
      await vi.waitFor(() => {
        expect(screen.getByText('Save Settings')).toBeTruthy();
      });
    });

    it('shows "Saving..." while save is in progress', async () => {
      // Make safeStorageSet hang so we can observe the saving state
      let resolveSave!: (value: boolean) => void;
      (safeStorageSet as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise<boolean>((resolve) => { resolveSave = resolve; })
      );
      render(() => <GeneralSettings />);
      await vi.waitFor(() => expect(screen.getByText('Save Settings')).toBeTruthy());
      fireEvent.click(screen.getByText('Save Settings'));
      await vi.waitFor(() => {
        expect(screen.getByText('Saving...')).toBeTruthy();
      });
      // Resolve to clean up
      resolveSave(true);
      await vi.waitFor(() => {
        expect(screen.getByText('Saved!')).toBeTruthy();
      });
    });

    it('shows "Saved!" after successful save then reverts', async () => {
      vi.useFakeTimers();
      render(() => <GeneralSettings />);
      await vi.waitFor(() => expect(screen.getByText('Save Settings')).toBeTruthy());
      fireEvent.click(screen.getByText('Save Settings'));
      await vi.waitFor(() => {
        expect(screen.getByText('Saved!')).toBeTruthy();
      });
      // After 2 seconds, it should revert to "Save Settings"
      vi.advanceTimersByTime(2100);
      await vi.waitFor(() => {
        expect(screen.getByText('Save Settings')).toBeTruthy();
      });
      vi.useRealTimers();
    });

    it('shows error text when save fails', async () => {
      (safeStorageSet as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      render(() => <GeneralSettings />);
      await vi.waitFor(() => expect(screen.getByText('Save Settings')).toBeTruthy());
      fireEvent.click(screen.getByText('Save Settings'));
      await vi.waitFor(() => {
        const errorEl = document.querySelector('[style*="#dc2626"]') ||
          document.querySelector('[style*="color: rgb(220, 38, 38)"]');
        expect(errorEl).toBeTruthy();
      });
    });

    it('button is disabled during save', async () => {
      let resolveSave!: (value: boolean) => void;
      (safeStorageSet as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise<boolean>((resolve) => { resolveSave = resolve; })
      );
      render(() => <GeneralSettings />);
      await vi.waitFor(() => expect(screen.getByText('Save Settings')).toBeTruthy());
      const btn = screen.getByText('Save Settings') as HTMLButtonElement;
      fireEvent.click(btn);
      await vi.waitFor(() => {
        const savingBtn = screen.getByText('Saving...').closest('button') as HTMLButtonElement;
        expect(savingBtn.disabled).toBe(true);
      });
      resolveSave(true);
    });
  });
});
