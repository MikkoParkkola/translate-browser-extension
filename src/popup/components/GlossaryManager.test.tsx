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
});
