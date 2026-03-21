/**
 * GlossaryManager component unit tests
 *
 * Tests the glossary management UI for custom term replacements.
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

// Mock glossary core module
vi.mock('../../core/glossary', () => ({
  glossary: {
    getGlossary: vi.fn().mockResolvedValue({}),
    addTerm: vi.fn().mockResolvedValue(undefined),
    removeTerm: vi.fn().mockResolvedValue(undefined),
    clearGlossary: vi.fn().mockResolvedValue(undefined),
    exportGlossary: vi.fn().mockResolvedValue('{}'),
    importGlossary: vi.fn().mockResolvedValue(0),
  },
}));

import { GlossaryManager } from './GlossaryManager';
import { glossary } from '../../core/glossary';

// Helper to mock glossary with terms
const MOCK_TERMS = {
  API: { replacement: 'rajapinta', caseSensitive: true, description: 'Technical term' },
  cloud: { replacement: 'pilvi', caseSensitive: false },
  server: { replacement: 'palvelin', caseSensitive: false, description: 'Backend server' },
};

describe('GlossaryManager', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    // Default: empty glossary
    (glossary.getGlossary as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  // -----------------------------------------------------------------------
  // Basic render
  // -----------------------------------------------------------------------

  it('renders the "Glossary" title', async () => {
    render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('Glossary')).toBeTruthy();
    });
  });

  it('shows description text about custom term replacements', async () => {
    render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(
        screen.getByText(
          'Define custom term replacements. Terms are replaced before translation and restored after.',
        ),
      ).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // Empty state
  // -----------------------------------------------------------------------

  it('shows "No glossary terms defined" when empty', async () => {
    render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('No glossary terms defined')).toBeTruthy();
    });
  });

  it('empty glossary shows correct stats "0 terms defined"', async () => {
    render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('0 terms defined')).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // Add Term button and form
  // -----------------------------------------------------------------------

  it('shows "+ Add Term" button', async () => {
    render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('+ Add Term')).toBeTruthy();
    });
  });

  it('clicking "+ Add Term" shows the add form', async () => {
    render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('+ Add Term')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('+ Add Term'));

    await vi.waitFor(() => {
      expect(screen.getByText('Original Term')).toBeTruthy();
      expect(screen.getByText('Replacement')).toBeTruthy();
    });
  });

  it('add form has fields for term, replacement, description, case sensitive', async () => {
    const { container } = render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('+ Add Term')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('+ Add Term'));

    await vi.waitFor(() => {
      expect(screen.getByText('Original Term')).toBeTruthy();
      expect(screen.getByText('Replacement')).toBeTruthy();
      expect(screen.getByText('Description (optional)')).toBeTruthy();
      expect(screen.getByText('Case sensitive')).toBeTruthy();

      // Verify inputs with placeholders
      expect(container.querySelector('input[placeholder="e.g., API"]')).toBeTruthy();
      expect(container.querySelector('input[placeholder="e.g., rajapinta"]')).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // Glossary with terms
  // -----------------------------------------------------------------------

  it('glossary with terms shows search input', async () => {
    (glossary.getGlossary as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TERMS);

    const { container } = render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      const searchInput = container.querySelector('input[placeholder="Search terms..."]');
      expect(searchInput).toBeTruthy();
    });
  });

  it('glossary with terms shows term entries', async () => {
    (glossary.getGlossary as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TERMS);

    render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('API')).toBeTruthy();
      expect(screen.getByText('rajapinta')).toBeTruthy();
      expect(screen.getByText('cloud')).toBeTruthy();
      expect(screen.getByText('pilvi')).toBeTruthy();
      expect(screen.getByText('server')).toBeTruthy();
      expect(screen.getByText('palvelin')).toBeTruthy();
    });
  });

  it('glossary with terms shows correct stats', async () => {
    (glossary.getGlossary as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TERMS);

    render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('3 terms defined')).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // Search filtering
  // -----------------------------------------------------------------------

  it('search filters terms by term name', async () => {
    (glossary.getGlossary as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TERMS);

    const { container } = render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('API')).toBeTruthy();
    });

    const searchInput = container.querySelector('input[placeholder="Search terms..."]') as HTMLInputElement;
    fireEvent.input(searchInput, { target: { value: 'API' } });

    await vi.waitFor(() => {
      expect(screen.getByText('API')).toBeTruthy();
      expect(screen.getByText('rajapinta')).toBeTruthy();
      // Other terms should be filtered out
      expect(screen.queryByText('cloud')).toBeNull();
      expect(screen.queryByText('server')).toBeNull();
    });
  });

  it('search filters terms by replacement', async () => {
    (glossary.getGlossary as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TERMS);

    const { container } = render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('cloud')).toBeTruthy();
    });

    const searchInput = container.querySelector('input[placeholder="Search terms..."]') as HTMLInputElement;
    fireEvent.input(searchInput, { target: { value: 'pilvi' } });

    await vi.waitFor(() => {
      expect(screen.getByText('cloud')).toBeTruthy();
      expect(screen.getByText('pilvi')).toBeTruthy();
      expect(screen.queryByText('API')).toBeNull();
      expect(screen.queryByText('server')).toBeNull();
    });
  });

  it('search shows "No matching terms found" for no results', async () => {
    (glossary.getGlossary as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TERMS);

    const { container } = render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('API')).toBeTruthy();
    });

    const searchInput = container.querySelector('input[placeholder="Search terms..."]') as HTMLInputElement;
    fireEvent.input(searchInput, { target: { value: 'nonexistent' } });

    await vi.waitFor(() => {
      expect(screen.getByText('No matching terms found')).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // Export / Import / Clear
  // -----------------------------------------------------------------------

  it('export button exists', async () => {
    render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('Export')).toBeTruthy();
    });
  });

  it('import file input exists', async () => {
    const { container } = render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('Import')).toBeTruthy();
    });

    const fileInput = container.querySelector('input[type="file"][accept=".json"]');
    expect(fileInput).toBeTruthy();
  });

  it('when glossary has terms, Clear All button appears', async () => {
    (glossary.getGlossary as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TERMS);

    render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('Clear All')).toBeTruthy();
    });
  });

  it('Clear All button is not shown when glossary is empty', async () => {
    render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('0 terms defined')).toBeTruthy();
    });
    expect(screen.queryByText('Clear All')).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Adding a term
  // -----------------------------------------------------------------------

  it('adding a term calls glossary.addTerm with correct args', async () => {
    // After adding, the glossary will contain the new term
    (glossary.addTerm as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (glossary.getGlossary as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({}) // initial load
      .mockResolvedValueOnce({ hello: { replacement: 'hei', caseSensitive: false } }); // after add

    const { container } = render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('+ Add Term')).toBeTruthy();
    });

    // Open the add form
    fireEvent.click(screen.getByText('+ Add Term'));

    await vi.waitFor(() => {
      expect(screen.getByText('Original Term')).toBeTruthy();
    });

    // Fill in the form
    const termInput = container.querySelector('input[placeholder="e.g., API"]') as HTMLInputElement;
    const replacementInput = container.querySelector('input[placeholder="e.g., rajapinta"]') as HTMLInputElement;
    const descriptionInput = container.querySelector(
      'input[placeholder="e.g., Technical term for interface"]',
    ) as HTMLInputElement;

    fireEvent.input(termInput, { target: { value: 'hello' } });
    fireEvent.input(replacementInput, { target: { value: 'hei' } });
    fireEvent.input(descriptionInput, { target: { value: 'Greeting' } });

    // Submit
    fireEvent.click(screen.getByText('Add Term'));

    await vi.waitFor(() => {
      expect(glossary.addTerm).toHaveBeenCalledWith('hello', 'hei', false, 'Greeting');
    });
  });

  it('shows error when adding term with empty fields', async () => {
    const { container } = render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('+ Add Term')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('+ Add Term'));
    await vi.waitFor(() => {
      expect(screen.getByText('Add Term')).toBeTruthy();
    });

    // Click Add Term without filling fields
    fireEvent.click(screen.getByText('Add Term'));

    await vi.waitFor(() => {
      expect(screen.getByText('Term and replacement are required')).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // Close button
  // -----------------------------------------------------------------------

  it('close button calls onClose prop', async () => {
    const onClose = vi.fn();
    render(() => <GlossaryManager onClose={onClose} />);
    await vi.waitFor(() => {
      expect(screen.getByLabelText('Close')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  // -----------------------------------------------------------------------
  // Delete term
  // -----------------------------------------------------------------------

  it('delete button calls glossary.removeTerm', async () => {
    (glossary.getGlossary as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(MOCK_TERMS) // initial load
      .mockResolvedValueOnce({}); // after delete

    render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('API')).toBeTruthy();
    });

    // Click the delete button for the "API" term
    const deleteButton = screen.getByLabelText('Delete term API');
    fireEvent.click(deleteButton);

    await vi.waitFor(() => {
      expect(glossary.removeTerm).toHaveBeenCalledWith('API');
    });
  });

  // -----------------------------------------------------------------------
  // Edit mode
  // -----------------------------------------------------------------------

  it('clicking a term info row enters edit mode', async () => {
    (glossary.getGlossary as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TERMS);
    render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('API')).toBeTruthy();
    });

    // Click on the term info row to start editing
    const termInfo = screen.getByText('API').closest('.term-info') as HTMLElement;
    fireEvent.click(termInfo);

    await vi.waitFor(() => {
      // Edit mode shows Save and Cancel buttons
      expect(screen.getByText('Save')).toBeTruthy();
      expect(screen.getByText('Cancel')).toBeTruthy();
    });
  });

  it('cancel button exits edit mode', async () => {
    (glossary.getGlossary as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TERMS);
    render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('API')).toBeTruthy();
    });

    const termInfo = screen.getByText('API').closest('.term-info') as HTMLElement;
    fireEvent.click(termInfo);

    await vi.waitFor(() => {
      expect(screen.getByText('Cancel')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Cancel'));

    await vi.waitFor(() => {
      expect(screen.queryByText('Cancel')).toBeNull();
    });
  });

  it('save button with valid replacement calls glossary.addTerm and reloads', async () => {
    (glossary.getGlossary as ReturnType<typeof vi.fn>)
      .mockResolvedValue(MOCK_TERMS);
    (glossary.addTerm as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const { container } = render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('API')).toBeTruthy();
    });

    // Click on API term to edit
    const termInfo = screen.getByText('API').closest('.term-info') as HTMLElement;
    fireEvent.click(termInfo);

    await vi.waitFor(() => {
      expect(screen.getByText('Save')).toBeTruthy();
    });

    // Update the replacement field in edit form
    const editInputs = container.querySelectorAll('.term-edit-form input[type="text"]');
    // editInputs[1] is the replacement field
    fireEvent.input(editInputs[1], { target: { value: 'new-replacement' } });

    fireEvent.click(screen.getByText('Save'));

    await vi.waitFor(() => {
      expect(glossary.addTerm).toHaveBeenCalled();
    });
  });

  it('save button with empty replacement shows error', async () => {
    (glossary.getGlossary as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TERMS);

    const { container } = render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('API')).toBeTruthy();
    });

    const termInfo = screen.getByText('API').closest('.term-info') as HTMLElement;
    fireEvent.click(termInfo);

    await vi.waitFor(() => {
      expect(screen.getByText('Save')).toBeTruthy();
    });

    // Clear the replacement field
    const editInputs = container.querySelectorAll('.term-edit-form input[type="text"]');
    fireEvent.input(editInputs[1], { target: { value: '' } });

    fireEvent.click(screen.getByText('Save'));

    await vi.waitFor(() => {
      expect(screen.getByText('Replacement is required')).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // Export button
  // -----------------------------------------------------------------------

  it('export button calls glossary.exportGlossary', async () => {
    // Mock Blob and URL APIs used in handleExport
    const mockCreateObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    const mockRevokeObjectURL = vi.fn();
    Object.defineProperty(globalThis, 'URL', {
      value: { createObjectURL: mockCreateObjectURL, revokeObjectURL: mockRevokeObjectURL },
      writable: true,
      configurable: true,
    });

    (glossary.exportGlossary as ReturnType<typeof vi.fn>).mockResolvedValue('{}');

    render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('Export')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Export'));

    await vi.waitFor(() => {
      expect(glossary.exportGlossary).toHaveBeenCalled();
    });
  });

  it('export button shows error on failure', async () => {
    (glossary.exportGlossary as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('export fail'));

    render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('Export')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Export'));

    await vi.waitFor(() => {
      expect(screen.getByText('Failed to export glossary')).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // Load error
  // -----------------------------------------------------------------------

  it('shows error message when glossary fails to load', async () => {
    (glossary.getGlossary as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('load failed'));

    render(() => <GlossaryManager />);

    await vi.waitFor(() => {
      expect(screen.getByText('Failed to load glossary')).toBeTruthy();
    });
  });

  it('delete error shows error message', async () => {
    (glossary.getGlossary as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TERMS);
    (glossary.removeTerm as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('delete fail'));

    render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('API')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('Delete term API'));

    await vi.waitFor(() => {
      expect(screen.getByText('Failed to delete term')).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // Case sensitive badge
  // -----------------------------------------------------------------------

  it('case sensitive term shows "Aa" badge', async () => {
    (glossary.getGlossary as ReturnType<typeof vi.fn>).mockResolvedValue({
      API: { replacement: 'rajapinta', caseSensitive: true },
    });

    render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('Aa')).toBeTruthy();
    });
  });

  it('non-case-sensitive term does not show "Aa" badge', async () => {
    (glossary.getGlossary as ReturnType<typeof vi.fn>).mockResolvedValue({
      cloud: { replacement: 'pilvi', caseSensitive: false },
    });

    render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('cloud')).toBeTruthy();
    });
    expect(screen.queryByText('Aa')).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Description display
  // -----------------------------------------------------------------------

  it('term with description shows the description', async () => {
    (glossary.getGlossary as ReturnType<typeof vi.fn>).mockResolvedValue({
      API: { replacement: 'rajapinta', caseSensitive: true, description: 'Technical term' },
    });

    render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('Technical term')).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // Search filtering by description
  // -----------------------------------------------------------------------

  it('search filters by description field', async () => {
    (glossary.getGlossary as ReturnType<typeof vi.fn>).mockResolvedValue({
      API: { replacement: 'rajapinta', caseSensitive: true, description: 'Technical term' },
      cloud: { replacement: 'pilvi', caseSensitive: false, description: 'Cloud computing' },
    });

    const { container } = render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('API')).toBeTruthy();
    });

    const searchInput = container.querySelector('input[placeholder="Search terms..."]') as HTMLInputElement;
    fireEvent.input(searchInput, { target: { value: 'Technical' } });

    await vi.waitFor(() => {
      expect(screen.getByText('API')).toBeTruthy();
      expect(screen.queryByText('cloud')).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Clear all terms
  // -----------------------------------------------------------------------

  it('clearAllTerms clears glossary when confirm returns true', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));

    (glossary.getGlossary as ReturnType<typeof vi.fn>).mockResolvedValue({
      hello: { replacement: 'hei', caseSensitive: false },
    });

    render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('hello')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Clear All'));
    await vi.waitFor(() => {
      expect(glossary.clearGlossary).toHaveBeenCalled();
    });
  });

  it('clearAllTerms does nothing when confirm returns false', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));

    (glossary.getGlossary as ReturnType<typeof vi.fn>).mockResolvedValue({
      hello: { replacement: 'hei', caseSensitive: false },
    });

    render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('hello')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Clear All'));
    expect(glossary.clearGlossary).not.toHaveBeenCalled();
  });

  it('clearAllTerms shows error when clearGlossary rejects', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    (glossary.clearGlossary as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('clear failed'));

    (glossary.getGlossary as ReturnType<typeof vi.fn>).mockResolvedValue({
      hello: { replacement: 'hei', caseSensitive: false },
    });

    render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('hello')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Clear All'));
    await vi.waitFor(() => {
      expect(screen.getByText('Failed to clear glossary')).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // Import
  // -----------------------------------------------------------------------

  it('handleImport reads file and imports terms', async () => {
    vi.stubGlobal('alert', vi.fn());
    (glossary.importGlossary as ReturnType<typeof vi.fn>).mockResolvedValueOnce(5);

    render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('Import')).toBeTruthy();
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['{"hello":"world"}'], 'glossary.json', { type: 'application/json' });
    Object.defineProperty(fileInput, 'files', { value: [file], writable: false });
    fireEvent.change(fileInput);

    await vi.waitFor(() => {
      expect(glossary.importGlossary).toHaveBeenCalledWith('{"hello":"world"}');
    });
    expect(window.alert).toHaveBeenCalledWith('Imported 5 glossary terms');
  });

  it('handleImport shows error message for Error instance', async () => {
    (glossary.importGlossary as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('bad format'));

    render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('Import')).toBeTruthy();
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['invalid'], 'glossary.json', { type: 'application/json' });
    Object.defineProperty(fileInput, 'files', { value: [file], writable: false });
    fireEvent.change(fileInput);

    await vi.waitFor(() => {
      expect(screen.getByText('Failed to import glossary: bad format')).toBeTruthy();
    });
  });

  it('handleImport shows Unknown error for non-Error throw', async () => {
    (glossary.importGlossary as ReturnType<typeof vi.fn>).mockRejectedValueOnce('string error');

    render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('Import')).toBeTruthy();
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['bad'], 'glossary.json', { type: 'application/json' });
    Object.defineProperty(fileInput, 'files', { value: [file], writable: false });
    fireEvent.change(fileInput);

    await vi.waitFor(() => {
      expect(screen.getByText('Failed to import glossary: Unknown error')).toBeTruthy();
    });
  });

  it('handleImport does nothing when no file is selected', async () => {
    render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('Import')).toBeTruthy();
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', { value: [], writable: false });
    fireEvent.change(fileInput);

    expect(glossary.importGlossary).not.toHaveBeenCalled();
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
    (glossary.exportGlossary as ReturnType<typeof vi.fn>).mockResolvedValueOnce('{"hello":"world"}');

    render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('Export')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Export'));
    await vi.waitFor(() => {
      expect(glossary.exportGlossary).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(clickSpy).toHaveBeenCalled();
    });

    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // addTerm error
  // -----------------------------------------------------------------------

  it('shows error when addTerm rejects', async () => {
    (glossary.addTerm as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('add failed'));

    render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('+ Add Term')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('+ Add Term'));
    await vi.waitFor(() => {
      expect(screen.getByPlaceholderText('e.g., API')).toBeTruthy();
    });

    fireEvent.input(screen.getByPlaceholderText('e.g., API'), { target: { value: 'test' } });
    fireEvent.input(screen.getByPlaceholderText('e.g., rajapinta'), { target: { value: 'testi' } });
    fireEvent.click(screen.getByText('Add Term'));

    await vi.waitFor(() => {
      expect(screen.getByText('Failed to add term')).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // saveEdit error
  // -----------------------------------------------------------------------

  it('shows error when saveEdit rejects', async () => {
    (glossary.getGlossary as ReturnType<typeof vi.fn>).mockResolvedValue({
      hello: { replacement: 'hei', caseSensitive: false },
    });
    (glossary.addTerm as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('edit failed'));

    render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('hello')).toBeTruthy();
    });

    // Click the term-info to start editing
    const termInfo = screen.getByText('hello').closest('.term-info') as HTMLElement;
    fireEvent.click(termInfo);

    await vi.waitFor(() => {
      expect(screen.getByText('Save')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Save'));
    await vi.waitFor(() => {
      expect(screen.getByText('Failed to update term')).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // addNewTerm with description
  // -----------------------------------------------------------------------

  it('passes description to addTerm when provided', async () => {
    render(() => <GlossaryManager />);
    await vi.waitFor(() => {
      expect(screen.getByText('+ Add Term')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('+ Add Term'));
    await vi.waitFor(() => {
      expect(screen.getByPlaceholderText('e.g., API')).toBeTruthy();
    });

    fireEvent.input(screen.getByPlaceholderText('e.g., API'), { target: { value: 'test' } });
    fireEvent.input(screen.getByPlaceholderText('e.g., rajapinta'), { target: { value: 'testi' } });
    fireEvent.input(screen.getByPlaceholderText(/Technical term/), { target: { value: 'My description' } });
    fireEvent.click(screen.getByText('Add Term'));

    await vi.waitFor(() => {
      expect(glossary.addTerm).toHaveBeenCalledWith('test', 'testi', false, 'My description');
    });
  });

  // -----------------------------------------------------------------------
  // Branch coverage — saveEdit without editing term
  // -----------------------------------------------------------------------

  describe('branch coverage — saveEdit without editing term', () => {
    it('no edit form is showing when editingTerm is null', async () => {
      (glossary.getGlossary as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TERMS);

      render(() => <GlossaryManager />);

      // Wait for terms to load
      await vi.waitFor(() => {
        expect(screen.getByText('3 terms defined')).toBeTruthy();
      });

      // editingTerm() is null — no Save button from edit form should be present
      expect(screen.queryByText('Save')).toBeNull();
      expect(screen.queryByText('Cancel')).toBeNull();
    });
  });
});
