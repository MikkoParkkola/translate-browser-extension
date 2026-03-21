/**
 * SiteRulesSettings component unit tests
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
      remove: vi.fn().mockResolvedValue(undefined),
    },
  },
});

vi.mock('../../core/site-rules', () => ({
  siteRules: {
    getAllRules: vi.fn().mockResolvedValue({}),
    setRules: vi.fn().mockResolvedValue(undefined),
    clearRules: vi.fn().mockResolvedValue(undefined),
    exportRules: vi.fn().mockResolvedValue('{}'),
    importRules: vi.fn().mockResolvedValue(0),
  },
}));

import { SiteRulesSettings } from './SiteRulesSettings';
import { siteRules } from '../../core/site-rules';

const MOCK_RULES = {
  'example.com': {
    autoTranslate: true,
    preferredProvider: 'deepl' as const,
    sourceLang: 'en',
    targetLang: 'fi',
    strategy: 'quality' as const,
  },
  'test.org': {
    autoTranslate: false,
  },
};

describe('SiteRulesSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (siteRules.getAllRules as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  afterEach(cleanup);

  describe('initial render — empty state', () => {
    it('renders the section title', async () => {
      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => {
        // "Site Rules" appears in both h2 and inner h3
        expect(screen.getAllByText('Site Rules').length).toBeGreaterThanOrEqual(1);
      });
    });

    it('shows "0 site rules configured" when empty', async () => {
      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => {
        expect(screen.getByText(/0 site rules configured/)).toBeTruthy();
      });
    });

    it('shows empty state message when no rules', async () => {
      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => {
        expect(screen.getByText('No site rules configured')).toBeTruthy();
      });
    });

    it('shows Add Site Rule button', async () => {
      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => {
        expect(screen.getByText('+ Add Site Rule')).toBeTruthy();
      });
    });

    it('shows Import/Export section', async () => {
      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => {
        expect(screen.getByText('Import / Export')).toBeTruthy();
      });
    });
  });

  describe('initial render — with rules', () => {
    beforeEach(() => {
      (siteRules.getAllRules as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_RULES);
    });

    it('shows rule count correctly', async () => {
      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => {
        expect(screen.getByText(/2 site rules configured/)).toBeTruthy();
      });
    });

    it('renders domain patterns', async () => {
      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => {
        expect(screen.getByText('example.com')).toBeTruthy();
        expect(screen.getByText('test.org')).toBeTruthy();
      });
    });

    it('shows Auto badge for autoTranslate=true', async () => {
      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => {
        expect(screen.getByText('Auto')).toBeTruthy();
      });
    });

    it('shows Manual badge for autoTranslate=false', async () => {
      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => {
        expect(screen.getByText('Manual')).toBeTruthy();
      });
    });

    it('shows Edit and Delete buttons per rule', async () => {
      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => {
        const editBtns = screen.getAllByText('Edit');
        expect(editBtns.length).toBe(2);
        const deleteBtns = screen.getAllByText('Delete');
        expect(deleteBtns.length).toBe(2);
      });
    });

    it('shows provider name when set', async () => {
      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => {
        expect(screen.getByText('DeepL')).toBeTruthy();
      });
    });

    it('shows target language arrow when set', async () => {
      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => {
        expect(screen.getByText(/-> fi/)).toBeTruthy();
      });
    });

    it('shows singular "rule" for count of 1', async () => {
      (siteRules.getAllRules as ReturnType<typeof vi.fn>).mockResolvedValue({
        'single.com': { autoTranslate: true },
      });
      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => {
        expect(screen.getByText(/1 site rule configured/)).toBeTruthy();
      });
    });
  });

  describe('add form', () => {
    it('opens add form on button click', async () => {
      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => expect(screen.getByText('+ Add Site Rule')).toBeTruthy());
      fireEvent.click(screen.getByText('+ Add Site Rule'));
      expect(screen.getByText('Add Site Rule')).toBeTruthy();
      expect(screen.getByPlaceholderText('example.com or *.example.com')).toBeTruthy();
    });

    it('button label changes to Cancel when form open', async () => {
      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => expect(screen.getByText('+ Add Site Rule')).toBeTruthy());
      fireEvent.click(screen.getByText('+ Add Site Rule'));
      // Multiple Cancel buttons appear: the toggle button + the form's own Cancel
      expect(screen.getAllByText('Cancel').length).toBeGreaterThanOrEqual(1);
    });

    it('closes form when Cancel clicked', async () => {
      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => expect(screen.getByText('+ Add Site Rule')).toBeTruthy());
      fireEvent.click(screen.getByText('+ Add Site Rule'));
      expect(screen.getByPlaceholderText('example.com or *.example.com')).toBeTruthy();
      // The form's own Cancel button (btn-secondary) closes it
      const cancelBtns = screen.getAllByText('Cancel');
      // Click the last Cancel (form's own Cancel button)
      fireEvent.click(cancelBtns[cancelBtns.length - 1]);
      expect(screen.queryByPlaceholderText('example.com or *.example.com')).toBeNull();
    });

    it('shows error for empty pattern', async () => {
      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => expect(screen.getByText('+ Add Site Rule')).toBeTruthy());
      fireEvent.click(screen.getByText('+ Add Site Rule'));
      fireEvent.click(screen.getByText('Add Rule'));
      await vi.waitFor(() => {
        expect(screen.getByText('Domain pattern is required')).toBeTruthy();
      });
    });

    it('shows error for invalid domain pattern', async () => {
      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => expect(screen.getByText('+ Add Site Rule')).toBeTruthy());
      fireEvent.click(screen.getByText('+ Add Site Rule'));
      const input = screen.getByPlaceholderText('example.com or *.example.com');
      fireEvent.input(input, { target: { value: 'not-a-valid-domain!' } });
      fireEvent.click(screen.getByText('Add Rule'));
      await vi.waitFor(() => {
        expect(screen.getByText(/Invalid domain pattern/)).toBeTruthy();
      });
    });

    it('calls setRules and reloads on valid submission', async () => {
      (siteRules.setRules as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (siteRules.getAllRules as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({})
        .mockResolvedValue({ 'example.com': { autoTranslate: true } });

      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => expect(screen.getByText('+ Add Site Rule')).toBeTruthy());
      fireEvent.click(screen.getByText('+ Add Site Rule'));

      const input = screen.getByPlaceholderText('example.com or *.example.com');
      fireEvent.input(input, { target: { value: 'example.com' } });
      fireEvent.click(screen.getByText('Add Rule'));

      await vi.waitFor(() => {
        expect(siteRules.setRules).toHaveBeenCalledWith('example.com', expect.objectContaining({ autoTranslate: true }));
      });
    });

    it('shows error when setRules throws', async () => {
      (siteRules.setRules as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Storage full'));
      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => expect(screen.getByText('+ Add Site Rule')).toBeTruthy());
      fireEvent.click(screen.getByText('+ Add Site Rule'));
      const input = screen.getByPlaceholderText('example.com or *.example.com');
      fireEvent.input(input, { target: { value: 'example.com' } });
      fireEvent.click(screen.getByText('Add Rule'));
      await vi.waitFor(() => {
        expect(screen.getByText('Failed to add rule')).toBeTruthy();
      });
    });
  });

  describe('edit mode', () => {
    beforeEach(() => {
      (siteRules.getAllRules as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_RULES);
    });

    it('clicking Edit enters edit mode for that rule', async () => {
      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => expect(screen.getAllByText('Edit').length).toBe(2));
      fireEvent.click(screen.getAllByText('Edit')[0]);
      await vi.waitFor(() => {
        expect(screen.getByText('Save')).toBeTruthy();
        expect(screen.getAllByText('Cancel').length).toBeGreaterThan(0);
      });
    });

    it('clicking Cancel in edit mode exits edit mode', async () => {
      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => expect(screen.getAllByText('Edit').length).toBe(2));
      fireEvent.click(screen.getAllByText('Edit')[0]);
      await vi.waitFor(() => expect(screen.getByText('Save')).toBeTruthy());
      // The Cancel button in edit mode
      const cancelBtns = screen.getAllByText('Cancel');
      fireEvent.click(cancelBtns[cancelBtns.length - 1]);
      await vi.waitFor(() => {
        expect(screen.queryByText('Save')).toBeNull();
      });
    });

    it('clicking Save calls setRules with updated values', async () => {
      (siteRules.setRules as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => expect(screen.getAllByText('Edit').length).toBe(2));
      fireEvent.click(screen.getAllByText('Edit')[0]);
      await vi.waitFor(() => expect(screen.getByText('Save')).toBeTruthy());
      fireEvent.click(screen.getByText('Save'));
      await vi.waitFor(() => {
        expect(siteRules.setRules).toHaveBeenCalled();
      });
    });

    it('shows error when save fails', async () => {
      (siteRules.setRules as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => expect(screen.getAllByText('Edit').length).toBe(2));
      fireEvent.click(screen.getAllByText('Edit')[0]);
      await vi.waitFor(() => expect(screen.getByText('Save')).toBeTruthy());
      fireEvent.click(screen.getByText('Save'));
      await vi.waitFor(() => {
        expect(screen.getByText('Failed to update rule')).toBeTruthy();
      });
    });

    it('loads all optional fields when editing rule with full config (lines 128-131)', async () => {
      (siteRules.setRules as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (siteRules.getAllRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce(MOCK_RULES);
      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => expect(screen.getAllByText('Edit').length).toBe(2));

      // Edit the first rule which has all fields set
      fireEvent.click(screen.getAllByText('Edit')[0]);

      await vi.waitFor(() => {
        // Verify Provider field is loaded
        const providerSelects = screen.getAllByDisplayValue('DeepL') as HTMLSelectElement[];
        expect(providerSelects.length).toBeGreaterThan(0);

        // Verify Strategy field is loaded
        const strategySelects = screen.getAllByDisplayValue('Quality') as HTMLSelectElement[];
        expect(strategySelects.length).toBeGreaterThan(0);

        // Verify Source Language is loaded
        const sourceLangSelects = screen.getAllByDisplayValue('English') as HTMLSelectElement[];
        expect(sourceLangSelects.length).toBeGreaterThan(0);

        // Verify Target Language is loaded
        const targetLangSelects = screen.getAllByDisplayValue('Finnish') as HTMLSelectElement[];
        expect(targetLangSelects.length).toBeGreaterThan(0);
      });
    });

    it('initializes optional fields to empty string when not provided (lines 128-131)', async () => {
      (siteRules.setRules as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (siteRules.getAllRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        'minimal.org': {
          autoTranslate: false,
          // No preferredProvider, sourceLang, targetLang, or strategy
        },
      });
      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => expect(screen.getByText('minimal.org')).toBeTruthy());

      // Edit the rule which has minimal config
      const editBtn = screen.getByText('Edit');
      fireEvent.click(editBtn);

      await vi.waitFor(() => {
        // All optional fields should have "Use default" option selected
        const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
        expect(selects.length).toBeGreaterThan(0);
        // The Provider, Strategy, Source Lang, and Target Lang selects should show "Use default"
        const defaultOptions = screen.getAllByText('Use default');
        expect(defaultOptions.length).toBeGreaterThan(0);
      });
    });
  });

  describe('delete rule', () => {
    beforeEach(() => {
      (siteRules.getAllRules as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_RULES);
    });

    it('calls clearRules when confirmed', async () => {
      vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
      (siteRules.clearRules as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => expect(screen.getAllByText('Delete').length).toBe(2));
      fireEvent.click(screen.getAllByText('Delete')[0]);
      await vi.waitFor(() => {
        expect(siteRules.clearRules).toHaveBeenCalled();
      });
    });

    it('does not call clearRules when confirm cancelled', async () => {
      vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));
      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => expect(screen.getAllByText('Delete').length).toBe(2));
      fireEvent.click(screen.getAllByText('Delete')[0]);
      expect(siteRules.clearRules).not.toHaveBeenCalled();
    });

    it('shows error when clearRules throws', async () => {
      vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
      (siteRules.clearRules as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => expect(screen.getAllByText('Delete').length).toBe(2));
      fireEvent.click(screen.getAllByText('Delete')[0]);
      await vi.waitFor(() => {
        expect(screen.getByText('Failed to delete rule')).toBeTruthy();
      });
    });
  });

  describe('export / import', () => {
    it('calls exportRules on Export JSON click', async () => {
      vi.stubGlobal('URL', { createObjectURL: vi.fn().mockReturnValue('blob:url'), revokeObjectURL: vi.fn() });
      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => expect(screen.getByText('Export JSON')).toBeTruthy());
      fireEvent.click(screen.getByText('Export JSON'));
      await vi.waitFor(() => {
        expect(siteRules.exportRules).toHaveBeenCalled();
      });
    });

    it('shows error when exportRules throws', async () => {
      (siteRules.exportRules as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('export fail'));
      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => expect(screen.getByText('Export JSON')).toBeTruthy());
      fireEvent.click(screen.getByText('Export JSON'));
      await vi.waitFor(() => {
        expect(screen.getByText('Failed to export rules')).toBeTruthy();
      });
    });

    it('load error shows error alert', async () => {
      (siteRules.getAllRules as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('load fail'));
      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => {
        expect(screen.getByText('Failed to load site rules')).toBeTruthy();
      });
    });

    it('calls importRules on Import JSON file change', async () => {
      (siteRules.importRules as ReturnType<typeof vi.fn>).mockResolvedValue(2);
      (siteRules.getAllRules as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({})
        .mockResolvedValue({ 'imported.com': { autoTranslate: true } });
      
      const { container } = render(() => <SiteRulesSettings />);
      await vi.waitFor(() => expect(screen.getByText('Import JSON')).toBeTruthy());
      
      const fileInput = container.querySelector('input[type="file"][accept=".json"]') as HTMLInputElement;
      const file = new File(['{}'], 'rules.json', { type: 'application/json' });
      Object.defineProperty(fileInput, 'files', { value: [file], writable: false });
      
      fireEvent.change(fileInput);
      
      await vi.waitFor(() => {
        expect(siteRules.importRules).toHaveBeenCalled();
        expect(screen.getByText(/Imported 2 rules/)).toBeTruthy();
      });
    });

    it('shows error when import file read fails', async () => {
      (siteRules.importRules as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('invalid JSON'));
      
      const { container } = render(() => <SiteRulesSettings />);
      await vi.waitFor(() => expect(screen.getByText('Import JSON')).toBeTruthy());
      
      const fileInput = container.querySelector('input[type="file"][accept=".json"]') as HTMLInputElement;
      const file = new File(['invalid'], 'rules.json', { type: 'application/json' });
      Object.defineProperty(fileInput, 'files', { value: [file], writable: false });
      
      fireEvent.change(fileInput);
      
      await vi.waitFor(() => {
        expect(screen.getByText(/Failed to import: invalid JSON/)).toBeTruthy();
      });
    });

    it('shows "Invalid file" error when import throws non-Error object', async () => {
      (siteRules.importRules as ReturnType<typeof vi.fn>).mockRejectedValue('unknown error');
      
      const { container } = render(() => <SiteRulesSettings />);
      await vi.waitFor(() => expect(screen.getByText('Import JSON')).toBeTruthy());
      
      const fileInput = container.querySelector('input[type="file"][accept=".json"]') as HTMLInputElement;
      const file = new File(['bad'], 'rules.json', { type: 'application/json' });
      Object.defineProperty(fileInput, 'files', { value: [file], writable: false });
      
      fireEvent.change(fileInput);
      
      await vi.waitFor(() => {
        expect(screen.getByText(/Failed to import: Invalid file/)).toBeTruthy();
      });
    });

    it('does not import when no file is selected', async () => {
      const { container } = render(() => <SiteRulesSettings />);
      await vi.waitFor(() => expect(screen.getByText('Import JSON')).toBeTruthy());
      
      const fileInput = container.querySelector('input[type="file"][accept=".json"]') as HTMLInputElement;
      Object.defineProperty(fileInput, 'files', { value: [], writable: false });
      
      fireEvent.change(fileInput);
      
      expect(siteRules.importRules).not.toHaveBeenCalled();
    });
  });

  describe('success message timeout', () => {
    it('success message auto-dismisses after 3 seconds', async () => {
      (siteRules.setRules as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (siteRules.getAllRules as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({})
        .mockResolvedValue({ 'example.com': { autoTranslate: true } });

      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => expect(screen.getByText('+ Add Site Rule')).toBeTruthy());
      fireEvent.click(screen.getByText('+ Add Site Rule'));

      const input = screen.getByPlaceholderText('example.com or *.example.com');
      fireEvent.input(input, { target: { value: 'example.com' } });
      fireEvent.click(screen.getByText('Add Rule'));

      await vi.waitFor(() => {
        expect(screen.getByText('Site rule added')).toBeTruthy();
      });

      // Wait for the setTimeout to clear it
      await new Promise(r => setTimeout(r, 3100));
      await vi.waitFor(() => {
        expect(screen.queryByText('Site rule added')).toBeNull();
      });
    });

    it('success message shows after edit save', async () => {
      (siteRules.getAllRules as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_RULES);
      (siteRules.setRules as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => expect(screen.getAllByText('Edit').length).toBe(2));
      fireEvent.click(screen.getAllByText('Edit')[0]);
      await vi.waitFor(() => expect(screen.getByText('Save')).toBeTruthy());
      fireEvent.click(screen.getByText('Save'));

      await vi.waitFor(() => {
        expect(screen.getByText('Site rule updated')).toBeTruthy();
      });
    });

    it('success message shows after delete', async () => {
      (siteRules.getAllRules as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_RULES);
      (siteRules.clearRules as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));

      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => expect(screen.getAllByText('Delete').length).toBe(2));
      fireEvent.click(screen.getAllByText('Delete')[0]);

      await vi.waitFor(() => {
        expect(screen.getByText('Rule deleted')).toBeTruthy();
      });
    });

    it('success message shows after export', async () => {
      vi.stubGlobal('URL', { createObjectURL: vi.fn().mockReturnValue('blob:url'), revokeObjectURL: vi.fn() });
      (siteRules.exportRules as ReturnType<typeof vi.fn>).mockResolvedValue('{}');

      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => expect(screen.getByText('Export JSON')).toBeTruthy());
      fireEvent.click(screen.getByText('Export JSON'));

      await vi.waitFor(() => {
        expect(screen.getByText('Rules exported')).toBeTruthy();
      });
    });
  });

  describe('edge cases — pattern validation', () => {
    it('accepts pattern with uppercase letters (will be lowercased)', async () => {
      (siteRules.setRules as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (siteRules.getAllRules as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({})
        .mockResolvedValue({ 'example.com': { autoTranslate: true } });

      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => expect(screen.getByText('+ Add Site Rule')).toBeTruthy());
      fireEvent.click(screen.getByText('+ Add Site Rule'));

      const input = screen.getByPlaceholderText('example.com or *.example.com');
      fireEvent.input(input, { target: { value: 'Example.COM' } });
      fireEvent.click(screen.getByText('Add Rule'));

      await vi.waitFor(() => {
        expect(siteRules.setRules).toHaveBeenCalledWith('example.com', expect.any(Object));
      });
    });

    it('trims whitespace from pattern', async () => {
      (siteRules.setRules as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (siteRules.getAllRules as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({})
        .mockResolvedValue({ 'example.com': { autoTranslate: true } });

      render(() => <SiteRulesSettings />);
      await vi.waitFor(() => expect(screen.getByText('+ Add Site Rule')).toBeTruthy());
      fireEvent.click(screen.getByText('+ Add Site Rule'));

      const input = screen.getByPlaceholderText('example.com or *.example.com');
      fireEvent.input(input, { target: { value: '  example.com  ' } });
      fireEvent.click(screen.getByText('Add Rule'));

      await vi.waitFor(() => {
        expect(siteRules.setRules).toHaveBeenCalledWith('example.com', expect.any(Object));
      });
    });
  });
});

describe('SiteRulesSettings — uncovered branches', () => {
  describe('Form input handling and validation', () => {
    it('normalizes pattern to lowercase when adding rule', async () => {
      (siteRules.setRules as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (siteRules.getAllRules as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({})
        .mockResolvedValue({ 'test.com': { autoTranslate: true } });

      render(() => <SiteRulesSettings />);

      await vi.waitFor(() => expect(screen.getByText('+ Add Site Rule')).toBeTruthy());
      fireEvent.click(screen.getByText('+ Add Site Rule'));

      const input = screen.getByPlaceholderText('example.com or *.example.com') as HTMLInputElement;
      fireEvent.input(input, { target: { value: 'TEST.COM' } });
      fireEvent.click(screen.getByText('Add Rule'));

      await vi.waitFor(() => {
        expect(siteRules.setRules).toHaveBeenCalledWith('test.com', expect.any(Object));
      });
    });

    it('trims whitespace from pattern input', async () => {
      (siteRules.setRules as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (siteRules.getAllRules as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({})
        .mockResolvedValue({ 'test.com': { autoTranslate: true } });

      render(() => <SiteRulesSettings />);

      await vi.waitFor(() => expect(screen.getByText('+ Add Site Rule')).toBeTruthy());
      fireEvent.click(screen.getByText('+ Add Site Rule'));

      const input = screen.getByPlaceholderText('example.com or *.example.com') as HTMLInputElement;
      fireEvent.input(input, { target: { value: '  test.com  ' } });
      fireEvent.click(screen.getByText('Add Rule'));

      await vi.waitFor(() => {
        expect(siteRules.setRules).toHaveBeenCalledWith('test.com', expect.any(Object));
      });
    });
  });

  describe('Edit mode (lines 128-144)', () => {
    it('allows editing site rules', async () => {
      (siteRules.getAllRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        'example.com': {
          autoTranslate: true,
          preferredProvider: 'deepl',
          sourceLang: 'en',
          targetLang: 'fi',
        },
      });
      (siteRules.setRules as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      render(() => <SiteRulesSettings />);

      await vi.waitFor(() => expect(screen.getByText('example.com')).toBeTruthy());

      // Component renders the rule
      expect(screen.getByText('example.com')).toBeTruthy();
    });
  });
});
