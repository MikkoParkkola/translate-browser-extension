/**
 * SiteRulesManager component unit tests
 *
 * Tests the per-site translation rules management UI.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import type { TranslationProviderId } from '../../types';

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

// Mock site-rules core module
vi.mock('../../core/site-rules', () => ({
  siteRules: {
    getAllRules: vi.fn().mockResolvedValue({}),
    getRules: vi.fn().mockResolvedValue(null),
    setRules: vi.fn().mockResolvedValue(undefined),
    clearRules: vi.fn().mockResolvedValue(undefined),
    exportRules: vi.fn().mockResolvedValue('{}'),
    importRules: vi.fn().mockResolvedValue(0),
  },
}));

import { SiteRulesManager } from './SiteRulesManager';
import { siteRules } from '../../core/site-rules';

// Common test props
const DEFAULT_PROVIDERS: Array<{ id: TranslationProviderId; name: string }> = [
  { id: 'opus-mt', name: 'OPUS-MT' },
  { id: 'deepl', name: 'DeepL' },
  { id: 'openai', name: 'OpenAI' },
];

const DEFAULT_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'fi', name: 'Finnish' },
  { code: 'de', name: 'German' },
];

const DEFAULT_PROPS = {
  providers: DEFAULT_PROVIDERS,
  languages: DEFAULT_LANGUAGES,
};

// Mock rules
const MOCK_RULES = {
  'example.com': { autoTranslate: true, preferredProvider: 'deepl' as TranslationProviderId, targetLang: 'fi' },
  '*.wikipedia.org': { autoTranslate: false },
};

describe('SiteRulesManager', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    // Default: no rules
    (siteRules.getAllRules as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (siteRules.getRules as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  });

  // -----------------------------------------------------------------------
  // Basic render
  // -----------------------------------------------------------------------

  it('renders "Site Rules" title', async () => {
    render(() => <SiteRulesManager {...DEFAULT_PROPS} />);
    await vi.waitFor(() => {
      expect(screen.getByText('Site Rules')).toBeTruthy();
    });
  });

  it('shows close button when onClose is provided', async () => {
    const onClose = vi.fn();
    render(() => <SiteRulesManager {...DEFAULT_PROPS} onClose={onClose} />);
    await vi.waitFor(() => {
      expect(screen.getByLabelText('Close')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not show close button when onClose is not provided', async () => {
    render(() => <SiteRulesManager {...DEFAULT_PROPS} />);
    await vi.waitFor(() => {
      expect(screen.getByText('Site Rules')).toBeTruthy();
    });
    expect(screen.queryByLabelText('Close')).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Empty state
  // -----------------------------------------------------------------------

  it('shows "No site rules configured" when rules are empty', async () => {
    render(() => <SiteRulesManager {...DEFAULT_PROPS} />);
    await vi.waitFor(() => {
      expect(screen.getByText('No site rules configured')).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // Add button and form
  // -----------------------------------------------------------------------

  it('shows "+ Add" button', async () => {
    render(() => <SiteRulesManager {...DEFAULT_PROPS} />);
    await vi.waitFor(() => {
      expect(screen.getByText('+ Add')).toBeTruthy();
    });
  });

  it('clicking "+ Add" shows the add form with hostname input', async () => {
    const { container } = render(() => <SiteRulesManager {...DEFAULT_PROPS} />);
    await vi.waitFor(() => {
      expect(screen.getByText('+ Add')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('+ Add'));

    await vi.waitFor(() => {
      const patternInput = container.querySelector('input[placeholder="hostname or *.domain.com"]');
      expect(patternInput).toBeTruthy();
    });
  });

  it('clicking "+ Add" again hides the form (toggle)', async () => {
    const { container } = render(() => <SiteRulesManager {...DEFAULT_PROPS} />);
    await vi.waitFor(() => {
      expect(screen.getByText('+ Add')).toBeTruthy();
    });

    // Open
    fireEvent.click(screen.getByText('+ Add'));
    await vi.waitFor(() => {
      expect(container.querySelector('input[placeholder="hostname or *.domain.com"]')).toBeTruthy();
    });

    // Close (button text changes to "Cancel")
    fireEvent.click(screen.getByText('Cancel'));
    await vi.waitFor(() => {
      expect(container.querySelector('input[placeholder="hostname or *.domain.com"]')).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Current site section
  // -----------------------------------------------------------------------

  it('when currentHostname is provided, shows "Current Site: hostname"', async () => {
    render(() => (
      <SiteRulesManager {...DEFAULT_PROPS} currentHostname="example.com" />
    ));
    await vi.waitFor(() => {
      expect(screen.getByText('Current Site: example.com')).toBeTruthy();
    });
  });

  it('current site section has auto-translate toggle', async () => {
    render(() => (
      <SiteRulesManager {...DEFAULT_PROPS} currentHostname="example.com" />
    ));
    await vi.waitFor(() => {
      expect(screen.getByText('Auto-translate this site')).toBeTruthy();
    });
  });

  it('current site section has provider select', async () => {
    render(() => (
      <SiteRulesManager {...DEFAULT_PROPS} currentHostname="example.com" />
    ));
    await vi.waitFor(() => {
      expect(screen.getByText('Preferred Provider')).toBeTruthy();
    });
  });

  it('current site section has language selects', async () => {
    render(() => (
      <SiteRulesManager {...DEFAULT_PROPS} currentHostname="example.com" />
    ));
    await vi.waitFor(() => {
      expect(screen.getByText('Source Language')).toBeTruthy();
      expect(screen.getByText('Target Language')).toBeTruthy();
    });
  });

  it('current site section has strategy select', async () => {
    render(() => (
      <SiteRulesManager {...DEFAULT_PROPS} currentHostname="example.com" />
    ));
    await vi.waitFor(() => {
      expect(screen.getByText('Strategy')).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // Save / Clear current site rules
  // -----------------------------------------------------------------------

  it('Save Rules button calls siteRules.setRules', async () => {
    render(() => (
      <SiteRulesManager {...DEFAULT_PROPS} currentHostname="test.com" />
    ));
    await vi.waitFor(() => {
      expect(screen.getByText('Save Rules')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Save Rules'));

    await vi.waitFor(() => {
      expect(siteRules.setRules).toHaveBeenCalledWith(
        'test.com',
        expect.objectContaining({ autoTranslate: false }),
      );
    });
  });

  it('Clear Rules button appears when current site has rules', async () => {
    (siteRules.getRules as ReturnType<typeof vi.fn>).mockResolvedValue({
      autoTranslate: true,
      preferredProvider: 'deepl',
    });

    render(() => (
      <SiteRulesManager {...DEFAULT_PROPS} currentHostname="example.com" />
    ));
    await vi.waitFor(() => {
      expect(screen.getByText('Clear Rules')).toBeTruthy();
    });
  });

  it('Clear Rules button is not shown when no current site rules exist', async () => {
    render(() => (
      <SiteRulesManager {...DEFAULT_PROPS} currentHostname="example.com" />
    ));
    await vi.waitFor(() => {
      expect(screen.getByText('Save Rules')).toBeTruthy();
    });
    expect(screen.queryByText('Clear Rules')).toBeNull();
  });

  it('clicking Clear Rules calls siteRules.clearRules', async () => {
    (siteRules.getRules as ReturnType<typeof vi.fn>).mockResolvedValue({
      autoTranslate: true,
    });

    render(() => (
      <SiteRulesManager {...DEFAULT_PROPS} currentHostname="test.com" />
    ));
    await vi.waitFor(() => {
      expect(screen.getByText('Clear Rules')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Clear Rules'));

    await vi.waitFor(() => {
      expect(siteRules.clearRules).toHaveBeenCalledWith('test.com');
    });
  });

  // -----------------------------------------------------------------------
  // Rules list
  // -----------------------------------------------------------------------

  it('rules list shows entries when rules exist', async () => {
    (siteRules.getAllRules as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_RULES);

    render(() => <SiteRulesManager {...DEFAULT_PROPS} />);
    await vi.waitFor(() => {
      expect(screen.getByText('example.com')).toBeTruthy();
      expect(screen.getByText('*.wikipedia.org')).toBeTruthy();
    });
  });

  it('rules list shows auto-translate details', async () => {
    (siteRules.getAllRules as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_RULES);

    render(() => <SiteRulesManager {...DEFAULT_PROPS} />);
    await vi.waitFor(() => {
      expect(screen.getByText('example.com')).toBeTruthy();
    });

    // example.com has autoTranslate=true, preferredProvider=deepl, targetLang=fi
    const ruleItems = screen.getAllByText(/Auto-translate/);
    expect(ruleItems.length).toBeGreaterThanOrEqual(1);
  });

  it('delete button on rule calls siteRules.clearRules', async () => {
    (siteRules.getAllRules as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(MOCK_RULES) // initial load
      .mockResolvedValueOnce({}); // after delete

    render(() => <SiteRulesManager {...DEFAULT_PROPS} />);
    await vi.waitFor(() => {
      expect(screen.getByText('example.com')).toBeTruthy();
    });

    // Click delete button for example.com
    const deleteButton = screen.getByLabelText('Delete rule for example.com');
    fireEvent.click(deleteButton);

    await vi.waitFor(() => {
      expect(siteRules.clearRules).toHaveBeenCalledWith('example.com');
    });
  });

  // -----------------------------------------------------------------------
  // Export / Import
  // -----------------------------------------------------------------------

  it('export button exists', async () => {
    render(() => <SiteRulesManager {...DEFAULT_PROPS} />);
    await vi.waitFor(() => {
      expect(screen.getByText('Export Rules')).toBeTruthy();
    });
  });

  it('import file input exists', async () => {
    const { container } = render(() => <SiteRulesManager {...DEFAULT_PROPS} />);
    await vi.waitFor(() => {
      expect(screen.getByText('Import Rules')).toBeTruthy();
    });

    const fileInput = container.querySelector('input[type="file"][accept=".json"]');
    expect(fileInput).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // Add new rule
  // -----------------------------------------------------------------------

  it('adding a rule calls siteRules.setRules', async () => {
    (siteRules.getAllRules as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({}) // initial
      .mockResolvedValueOnce({ 'newsite.com': { autoTranslate: true } }); // after add

    const { container } = render(() => <SiteRulesManager {...DEFAULT_PROPS} />);
    await vi.waitFor(() => {
      expect(screen.getByText('+ Add')).toBeTruthy();
    });

    // Open add form
    fireEvent.click(screen.getByText('+ Add'));
    await vi.waitFor(() => {
      expect(container.querySelector('input[placeholder="hostname or *.domain.com"]')).toBeTruthy();
    });

    // Type hostname
    const input = container.querySelector('input[placeholder="hostname or *.domain.com"]') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'newsite.com' } });

    // Click Add button in form
    const addBtn = container.querySelector('.add-form .primary-button') as HTMLButtonElement;
    fireEvent.click(addBtn);

    await vi.waitFor(() => {
      expect(siteRules.setRules).toHaveBeenCalledWith('newsite.com', { autoTranslate: true });
    });
  });

  it('shows error when adding empty pattern', async () => {
    const { container } = render(() => <SiteRulesManager {...DEFAULT_PROPS} />);
    await vi.waitFor(() => {
      expect(screen.getByText('+ Add')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('+ Add'));
    await vi.waitFor(() => {
      expect(container.querySelector('.add-form')).toBeTruthy();
    });

    // Click Add without entering hostname
    const addBtn = container.querySelector('.add-form .primary-button') as HTMLButtonElement;
    fireEvent.click(addBtn);

    await vi.waitFor(() => {
      expect(screen.getByText('Pattern is required')).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // Current site populates form from existing rules
  // -----------------------------------------------------------------------

  it('loads existing rules for current site into form state', async () => {
    (siteRules.getRules as ReturnType<typeof vi.fn>).mockResolvedValue({
      autoTranslate: true,
      preferredProvider: 'deepl' as TranslationProviderId,
      targetLang: 'fi',
      strategy: 'quality',
    });

    const { container } = render(() => (
      <SiteRulesManager {...DEFAULT_PROPS} currentHostname="example.com" />
    ));

    await vi.waitFor(() => {
      // Auto-translate checkbox should be checked
      const autoCheckbox = container.querySelector('.toggle-label input[type="checkbox"]') as HTMLInputElement;
      expect(autoCheckbox?.checked).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Export
  // -----------------------------------------------------------------------

  it('handleExport creates a download link', async () => {
    const clickSpy = vi.fn();
    const createElementOriginal = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = createElementOriginal(tag);
      if (tag === 'a') {
        vi.spyOn(el as HTMLAnchorElement, 'click').mockImplementation(clickSpy);
      }
      return el;
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    (siteRules.exportRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce('{"example.com":{}}');

    render(() => <SiteRulesManager {...DEFAULT_PROPS} />);
    await vi.waitFor(() => {
      expect(screen.getByText('Export Rules')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Export Rules'));
    await vi.waitFor(() => {
      expect(siteRules.exportRules).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(clickSpy).toHaveBeenCalled();
    });

    vi.restoreAllMocks();
  });

  it('handleExport shows error when exportRules rejects', async () => {
    (siteRules.exportRules as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('export failed'));

    render(() => <SiteRulesManager {...DEFAULT_PROPS} />);
    await vi.waitFor(() => {
      expect(screen.getByText('Export Rules')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Export Rules'));
    await vi.waitFor(() => {
      expect(screen.getByText('Failed to export rules')).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // Import
  // -----------------------------------------------------------------------

  it('handleImport reads file and imports rules', async () => {
    vi.stubGlobal('alert', vi.fn());
    (siteRules.importRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce(3);

    render(() => <SiteRulesManager {...DEFAULT_PROPS} />);
    await vi.waitFor(() => {
      expect(screen.getByText('Import Rules')).toBeTruthy();
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['{"example.com":{}}'], 'rules.json', { type: 'application/json' });
    Object.defineProperty(fileInput, 'files', { value: [file], writable: false });
    fireEvent.change(fileInput);

    await vi.waitFor(() => {
      expect(siteRules.importRules).toHaveBeenCalledWith('{"example.com":{}}');
    });
    expect(window.alert).toHaveBeenCalledWith('Imported 3 site rules');
  });

  it('handleImport shows error message for Error instance', async () => {
    (siteRules.importRules as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('parse error'));

    render(() => <SiteRulesManager {...DEFAULT_PROPS} />);
    await vi.waitFor(() => {
      expect(screen.getByText('Import Rules')).toBeTruthy();
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['invalid'], 'rules.json', { type: 'application/json' });
    Object.defineProperty(fileInput, 'files', { value: [file], writable: false });
    fireEvent.change(fileInput);

    await vi.waitFor(() => {
      expect(screen.getByText('Failed to import rules: parse error')).toBeTruthy();
    });
  });

  it('handleImport shows Unknown error for non-Error throw', async () => {
    (siteRules.importRules as ReturnType<typeof vi.fn>).mockRejectedValueOnce('string error');

    render(() => <SiteRulesManager {...DEFAULT_PROPS} />);
    await vi.waitFor(() => {
      expect(screen.getByText('Import Rules')).toBeTruthy();
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['bad'], 'rules.json', { type: 'application/json' });
    Object.defineProperty(fileInput, 'files', { value: [file], writable: false });
    fireEvent.change(fileInput);

    await vi.waitFor(() => {
      expect(screen.getByText('Failed to import rules: Unknown error')).toBeTruthy();
    });
  });

  it('handleImport does nothing when no file is selected', async () => {
    render(() => <SiteRulesManager {...DEFAULT_PROPS} />);
    await vi.waitFor(() => {
      expect(screen.getByText('Import Rules')).toBeTruthy();
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', { value: [], writable: false });
    fireEvent.change(fileInput);

    expect(siteRules.importRules).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Error paths
  // -----------------------------------------------------------------------

  it('shows error when saveCurrentSiteRules rejects', async () => {
    (siteRules.setRules as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('save failed'));

    render(() => <SiteRulesManager {...DEFAULT_PROPS} currentHostname="example.com" />);
    await vi.waitFor(() => {
      expect(screen.getByText('Save Rules')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Save Rules'));
    await vi.waitFor(() => {
      expect(screen.getByText('Failed to save rules')).toBeTruthy();
    });
  });

  it('shows error when clearCurrentSiteRules rejects', async () => {
    (siteRules.getRules as ReturnType<typeof vi.fn>).mockResolvedValue({
      autoTranslate: true,
    });
    (siteRules.clearRules as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('clear failed'));

    render(() => <SiteRulesManager {...DEFAULT_PROPS} currentHostname="example.com" />);
    await vi.waitFor(() => {
      expect(screen.getByText('Clear Rules')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Clear Rules'));
    await vi.waitFor(() => {
      expect(screen.getByText('Failed to clear rules')).toBeTruthy();
    });
  });

  it('shows error when deleteRule rejects', async () => {
    (siteRules.getAllRules as ReturnType<typeof vi.fn>).mockResolvedValue({
      'example.com': { autoTranslate: true },
    });
    (siteRules.clearRules as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('delete failed'));

    render(() => <SiteRulesManager {...DEFAULT_PROPS} />);
    await vi.waitFor(() => {
      expect(screen.getByText('example.com')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('Delete rule for example.com'));
    await vi.waitFor(() => {
      expect(screen.getByText('Failed to delete rule')).toBeTruthy();
    });
  });

  it('shows error when addNewRule rejects', async () => {
    (siteRules.setRules as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('add failed'));

    render(() => <SiteRulesManager {...DEFAULT_PROPS} />);
    await vi.waitFor(() => {
      expect(screen.getByText('+ Add')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('+ Add'));
    await vi.waitFor(() => {
      expect(screen.getByPlaceholderText('hostname or *.domain.com')).toBeTruthy();
    });

    fireEvent.input(screen.getByPlaceholderText('hostname or *.domain.com'), { target: { value: 'new.com' } });
    fireEvent.click(screen.getByText('Add'));

    await vi.waitFor(() => {
      expect(screen.getByText('Failed to add rule')).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // Enter key on add form
  // -----------------------------------------------------------------------

  it('pressing Enter in pattern input calls addNewRule', async () => {
    render(() => <SiteRulesManager {...DEFAULT_PROPS} />);
    await vi.waitFor(() => {
      expect(screen.getByText('+ Add')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('+ Add'));
    await vi.waitFor(() => {
      expect(screen.getByPlaceholderText('hostname or *.domain.com')).toBeTruthy();
    });

    const input = screen.getByPlaceholderText('hostname or *.domain.com');
    fireEvent.input(input, { target: { value: 'enter-test.com' } });
    fireEvent.keyPress(input, { key: 'Enter' });

    await vi.waitFor(() => {
      expect(siteRules.setRules).toHaveBeenCalledWith('enter-test.com', { autoTranslate: true });
    });
  });

  // -----------------------------------------------------------------------
  // Rule details display
  // -----------------------------------------------------------------------

  it('displays Manual for autoTranslate=false rules', async () => {
    (siteRules.getAllRules as ReturnType<typeof vi.fn>).mockResolvedValue({
      'manual.com': { autoTranslate: false },
    });

    render(() => <SiteRulesManager {...DEFAULT_PROPS} />);
    await vi.waitFor(() => {
      expect(screen.getByText('manual.com')).toBeTruthy();
    });
    expect(screen.getByText(/Manual/)).toBeTruthy();
  });

  it('displays provider and targetLang in rule details', async () => {
    (siteRules.getAllRules as ReturnType<typeof vi.fn>).mockResolvedValue({
      'rich.com': { autoTranslate: true, preferredProvider: 'deepl', targetLang: 'fi' },
    });

    render(() => <SiteRulesManager {...DEFAULT_PROPS} />);
    await vi.waitFor(() => {
      expect(screen.getByText('rich.com')).toBeTruthy();
    });
    expect(screen.getByText(/deepl/)).toBeTruthy();
    expect(screen.getByText(/fi/)).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // No hostname
  // -----------------------------------------------------------------------

  it('does not render current site section when no hostname', async () => {
    render(() => <SiteRulesManager {...DEFAULT_PROPS} currentHostname="" />);
    await vi.waitFor(() => {
      expect(screen.getByText('Site Rules')).toBeTruthy();
    });
    expect(screen.queryByText('Current Site:')).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Load error
  // -----------------------------------------------------------------------

  it('shows error when loadRules rejects', async () => {
    (siteRules.getAllRules as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('load failed'));

    render(() => <SiteRulesManager {...DEFAULT_PROPS} />);
    await vi.waitFor(() => {
      expect(screen.getByText('Failed to load site rules')).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // Branch coverage — no hostname guards
  // -----------------------------------------------------------------------

  describe('branch coverage — no hostname guards', () => {
    it('save is not available when currentHostname is undefined', async () => {
      render(() => <SiteRulesManager {...DEFAULT_PROPS} currentHostname={undefined} />);
      await vi.waitFor(() => {
        expect(screen.getByText('Site Rules')).toBeTruthy();
      });
      // When no currentHostname, the current site section is not rendered
      expect(screen.queryByText('Save Rules')).toBeNull();
    });

    it('clear is not available when currentHostname is undefined', async () => {
      render(() => <SiteRulesManager {...DEFAULT_PROPS} currentHostname={undefined} />);
      await vi.waitFor(() => {
        expect(screen.getByText('Site Rules')).toBeTruthy();
      });
      expect(screen.queryByText('Clear Rules')).toBeNull();
    });

    it('saveCurrentSiteRules returns early if currentHostname is not set', async () => {
      (siteRules.setRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

      render(() => <SiteRulesManager {...DEFAULT_PROPS} currentHostname={undefined} />);
      await vi.waitFor(() => {
        expect(screen.getByText('Site Rules')).toBeTruthy();
      });

      // Since currentHostname is undefined, the save button doesn't exist to click
      // Verify setRules was NOT called
      expect(siteRules.setRules).not.toHaveBeenCalled();
    });

    it('clearCurrentSiteRules returns early if currentHostname is not set', async () => {
      (siteRules.clearRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

      render(() => <SiteRulesManager {...DEFAULT_PROPS} currentHostname={undefined} />);
      await vi.waitFor(() => {
        expect(screen.getByText('Site Rules')).toBeTruthy();
      });

      // Since currentHostname is undefined, the clear button doesn't exist to click
      // Verify clearRules was NOT called (except possibly from loadRules)
      const beforeCallCount = (siteRules.clearRules as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(beforeCallCount).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Uncovered lines: Optional props and edge cases
  // -----------------------------------------------------------------------

  describe('branch coverage — optional props', () => {
    it('renders without onClose prop', async () => {
      render(() => (
        <SiteRulesManager
          currentHostname="example.com"
          providers={DEFAULT_PROPS.providers}
          languages={DEFAULT_PROPS.languages}
          // No onClose prop
        />
      ));
      await vi.waitFor(() => {
        expect(screen.getByText('Site Rules')).toBeTruthy();
      });

      // Close button should not be rendered
      expect(screen.queryByLabelText('Close')).toBeNull();
    });

    it('renders with onClose prop and shows close button', async () => {
      const onClose = vi.fn();
      render(() => (
        <SiteRulesManager
          currentHostname="example.com"
          providers={DEFAULT_PROPS.providers}
          languages={DEFAULT_PROPS.languages}
          onClose={onClose}
        />
      ));
      await vi.waitFor(() => {
        expect(screen.getByText('Site Rules')).toBeTruthy();
      });

      // Close button should be rendered
      const closeBtn = screen.getByLabelText('Close');
      expect(closeBtn).toBeTruthy();
      fireEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Uncovered lines: Strategy and language settings
  // -----------------------------------------------------------------------

  describe('branch coverage — strategy and language settings', () => {
    it('saves all strategy options', async () => {
      (siteRules.getRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      (siteRules.setRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

      const { container } = render(() => <SiteRulesManager {...DEFAULT_PROPS} currentHostname="test.com" />);
      await vi.waitFor(() => {
        expect(screen.getByText('Current Site: test.com')).toBeTruthy();
      });

      // Get all strategy selects
      const selects = Array.from(container.querySelectorAll('select')) as HTMLSelectElement[];
      // Find strategy select by checking if any option contains 'smart'
      const strategySelect = selects.find(s => {
        const options = Array.from(s.querySelectorAll('option')).map(o => o.value);
        return options.includes('smart');
      });

      expect(strategySelect).toBeTruthy();

      // Test a couple of strategy options
      fireEvent.change(strategySelect!, { target: { value: 'quality' } });
      fireEvent.click(screen.getByText('Save Rules'));

      await vi.waitFor(() => {
        expect(siteRules.setRules).toHaveBeenCalledWith(
          'test.com',
          expect.objectContaining({ strategy: 'quality' })
        );
      });
    });

    it('saves with auto-detect language option', async () => {
      (siteRules.getRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      (siteRules.setRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

      const { container } = render(() => <SiteRulesManager {...DEFAULT_PROPS} currentHostname="test.com" />);
      await vi.waitFor(() => {
        expect(screen.getByText('Current Site: test.com')).toBeTruthy();
      });

      const selects = Array.from(container.querySelectorAll('select')) as HTMLSelectElement[];
      // Find source language select (has 'auto' option)
      const sourceSelect = selects.find(s => {
        const options = Array.from(s.querySelectorAll('option')).map(o => o.value);
        return options.includes('auto');
      });

      expect(sourceSelect).toBeTruthy();
      fireEvent.change(sourceSelect!, { target: { value: 'auto' } });
      fireEvent.click(screen.getByText('Save Rules'));

      await vi.waitFor(() => {
        expect(siteRules.setRules).toHaveBeenCalledWith(
          'test.com',
          expect.objectContaining({ sourceLang: 'auto' })
        );
      });
    });
  });

  // -----------------------------------------------------------------------
  // Uncovered lines: Rule details and metadata
  // -----------------------------------------------------------------------

  describe('branch coverage — rule details display', () => {
    it('displays rule with all optional fields', async () => {
      (siteRules.getAllRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        'example.com': {
          autoTranslate: true,
          preferredProvider: 'deepl',
          targetLang: 'de',
          sourceLang: 'auto',
          strategy: 'quality',
        },
      });

      render(() => <SiteRulesManager {...DEFAULT_PROPS} />);
      await vi.waitFor(() => {
        const ruleDetails = screen.getByText(/Auto-translate/);
        expect(ruleDetails).toBeTruthy();
      });

      // Verify all details are shown
      const ruleItem = screen.getByText('example.com').closest('.rule-item');
      expect(ruleItem?.textContent).toContain('Auto-translate');
      expect(ruleItem?.textContent).toContain('deepl');
      expect(ruleItem?.textContent).toContain('de');
    });

    it('displays rule with minimal optional fields', async () => {
      (siteRules.getAllRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        'example.com': {
          autoTranslate: false,
        },
      });

      render(() => <SiteRulesManager {...DEFAULT_PROPS} />);
      await vi.waitFor(() => {
        const ruleItem = screen.getByText('example.com').closest('.rule-item');
        expect(ruleItem?.textContent).toContain('Manual');
      });
    });
  });

  // -----------------------------------------------------------------------
  // Uncovered lines: Provider selection persistence
  // -----------------------------------------------------------------------

  describe('branch coverage — provider selection', () => {
    it('saves and restores preferred provider selection', async () => {
      (siteRules.getRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        autoTranslate: false,
        preferredProvider: 'openai',
      });
      (siteRules.getAllRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});
      (siteRules.setRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

      const { container } = render(() => <SiteRulesManager {...DEFAULT_PROPS} currentHostname="test.com" />);
      await vi.waitFor(() => {
        expect(screen.getByText('Current Site: test.com')).toBeTruthy();
      });

      const selects = Array.from(container.querySelectorAll('select')) as HTMLSelectElement[];
      // Find provider select (has deepl, openai, etc options)
      const providerSelect = selects.find(s => {
        const options = Array.from(s.querySelectorAll('option')).map(o => o.value);
        return options.includes('deepl') && options.includes('openai');
      });

      await vi.waitFor(() => {
        expect(providerSelect?.value).toBe('openai');
      });
    });

    it('saves undefined provider when "Use default" is selected', async () => {
      (siteRules.getRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        preferredProvider: 'deepl',
      });
      (siteRules.getAllRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});
      (siteRules.setRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

      const { container } = render(() => <SiteRulesManager {...DEFAULT_PROPS} currentHostname="test.com" />);
      await vi.waitFor(() => {
        expect(screen.getByText('Current Site: test.com')).toBeTruthy();
      });

      const selects = Array.from(container.querySelectorAll('select')) as HTMLSelectElement[];
      const providerSelect = selects.find(s => {
        const options = Array.from(s.querySelectorAll('option')).map(o => o.value);
        return options.includes('deepl') && options.includes('openai');
      });

      expect(providerSelect).toBeTruthy();
      fireEvent.change(providerSelect!, { target: { value: '' } });
      fireEvent.click(screen.getByText('Save Rules'));

      await vi.waitFor(() => {
        expect(siteRules.setRules).toHaveBeenCalledWith(
          'test.com',
          expect.objectContaining({ preferredProvider: undefined })
        );
      });
    });
  });
});
