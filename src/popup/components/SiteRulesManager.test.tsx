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
});
